// @ts-nocheck
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { User as FirebaseUser } from 'firebase/auth';

import { db, auth, storage } from './firebaseConfig';
import { User, Post, Comment, Message, ReplyInfo, Story, Group, Campaign, LiveAudioRoom, LiveVideoRoom, Report, Notification, Lead, Author } from '../types';
import { DEFAULT_AVATARS, DEFAULT_COVER_PHOTOS, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, SPONSOR_CPM_BDT } from '../constants';

const { serverTimestamp, increment, arrayUnion, arrayRemove } = firebase.firestore.FieldValue;
const Timestamp = firebase.firestore.Timestamp;


// --- Helper Functions ---
const docToUser = (doc: firebase.firestore.DocumentSnapshot): User => {
    const data = doc.data();
    const user = {
        id: doc.id,
        ...data,
    } as User;
    
    // Convert Firestore Timestamps to ISO strings
    if (user.createdAt && user.createdAt instanceof firebase.firestore.Timestamp) {
        user.createdAt = user.createdAt.toDate().toISOString();
    }
    if (user.commentingSuspendedUntil && user.commentingSuspendedUntil instanceof firebase.firestore.Timestamp) {
        user.commentingSuspendedUntil = user.commentingSuspendedUntil.toDate().toISOString();
    }
    
    return user;
}

const docToPost = (doc: firebase.firestore.DocumentSnapshot): Post => {
    const data = doc.data() || {};
    return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        reactions: data.reactions || {},
        comments: (data.comments || []).map(c => ({
            ...c,
            createdAt: c.createdAt instanceof firebase.firestore.Timestamp ? c.createdAt.toDate().toISOString() : new Date().toISOString(),
        })),
        commentCount: data.commentCount || 0,
    } as Post;
}

// --- New Cloudinary Upload Helper ---
const uploadMediaToCloudinary = async (file: File | Blob, fileName: string): Promise<{ url: string, type: 'image' | 'video' | 'raw' }> => {
    const formData = new FormData();
    formData.append('file', file, fileName);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    
    let resourceType = 'auto';
    if (file.type.startsWith('video')) resourceType = 'video';
    else if (file.type.startsWith('image')) resourceType = 'image';
    else if (file.type.startsWith('audio')) resourceType = 'video'; // Cloudinary treats audio as video for transformations/delivery
    
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error('Cloudinary upload error:', errorData);
        throw new Error('Failed to upload media to Cloudinary');
    }

    const data = await response.json();
    return { url: data.secure_url, type: data.resource_type };
};

// --- Ad Targeting Helper ---
const matchesTargeting = (campaign: Campaign, user: User): boolean => {
    if (!campaign.targeting) return true; // No targeting set, matches everyone
    const { location, gender, ageRange, interests } = campaign.targeting;

    // Location check
    if (location && user.currentCity && location.toLowerCase().trim() !== user.currentCity.toLowerCase().trim()) {
        return false;
    }

    // Gender check
    if (gender && gender !== 'All' && user.gender && gender !== user.gender) {
        return false;
    }

    // Age range check
    if (ageRange && user.age) {
        const [min, max] = ageRange.split('-').map(part => parseInt(part, 10));
        if (user.age < min || user.age > max) {
            return false;
        }
    }

    // Interests check (simple bio check)
    if (interests && interests.length > 0 && user.bio) {
        const userBioLower = user.bio.toLowerCase();
        const hasMatchingInterest = interests.some(interest => userBioLower.includes(interest.toLowerCase()));
        if (!hasMatchingInterest) {
            return false;
        }
    }

    return true;
};


// --- Service Definition ---
export const firebaseService = {
    // --- Authentication ---
    onAuthStateChanged: (callback: (user: User | null) => void) => {
        return auth.onAuthStateChanged(async (firebaseUser: FirebaseUser | null) => {
            if (firebaseUser) {
                try {
                    const userProfile = await firebaseService.getUserProfileById(firebaseUser.uid);
                    if (userProfile && !userProfile.isDeactivated && !userProfile.isBanned) { // Check for deactivation and ban
                        callback(userProfile);
                    } else {
                        // If user is deactivated/banned or profile doesn't exist, sign them out.
                        if(userProfile?.isDeactivated) {
                            console.log(`User ${firebaseUser.uid} is deactivated. Signing out.`);
                        }
                        if(userProfile?.isBanned) {
                            console.log(`User ${firebaseUser.uid} is banned. Signing out.`);
                        }
                        await auth.signOut();
                        callback(null);
                    }
                } catch (error) {
                    console.warn("Could not reach Firestore. Creating a temporary user profile for offline use.", error);
                    const fallbackUser: User = {
                        id: firebaseUser.uid,
                        name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Offline User',
                        name_lowercase: (firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Offline User').toLowerCase(),
                        username: firebaseUser.email?.split('@')[0] || 'offlineuser',
                        email: firebaseUser.email!,
                        avatarUrl: firebaseUser.photoURL || DEFAULT_AVATARS[0],
                        bio: 'Working in offline mode.',
                        coverPhotoUrl: DEFAULT_COVER_PHOTOS[0],
                        privacySettings: { postVisibility: 'public', friendRequestPrivacy: 'everyone' },
                        blockedUserIds: [],
                        voiceCoins: 0,
                        createdAt: new Date().toISOString(),
                    };
                    callback(fallbackUser);
                }
            } else {
                callback(null);
            }
        });
    },

    async signUpWithEmail(email: string, pass: string, fullName: string, username: string): Promise<boolean> {
        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, pass);
            const user = userCredential.user;
            if (user) {
                const userRef = db.collection('users').doc(user.uid);
                const usernameRef = db.collection('usernames').doc(username.toLowerCase());

                const newUserProfile: Omit<User, 'id' | 'createdAt'> = {
                    name: fullName,
                    name_lowercase: fullName.toLowerCase(),
                    username: username.toLowerCase(),
                    email: email.toLowerCase(),
                    avatarUrl: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)],
                    bio: `Welcome to VoiceBook, I'm ${fullName.split(' ')[0]}!`,
                    coverPhotoUrl: DEFAULT_COVER_PHOTOS[Math.floor(Math.random() * DEFAULT_COVER_PHOTOS.length)],
                    privacySettings: { postVisibility: 'public', friendRequestPrivacy: 'everyone' },
                    notificationSettings: { likes: true, comments: true, friendRequests: true },
                    blockedUserIds: [],
                    voiceCoins: 100,
                    friendIds: [],
                    pendingFriendRequests: [],
                    sentFriendRequests: [],
                    createdAt: serverTimestamp(),
                };
                
                // In a real app, this should be a batched write or transaction
                await userRef.set(newUserProfile);
                await usernameRef.set({ userId: user.uid });
                return true;
            }
            return false;
        } catch (error) {
            console.error("Sign up error:", error);
            return false;
        }
    },

    async signInWithEmail(identifier: string, pass: string): Promise<void> {
        const lowerIdentifier = identifier.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        let emailToSignIn: string;

        if (emailRegex.test(lowerIdentifier)) {
            emailToSignIn = lowerIdentifier;
        } else {
            // It's a username, look it up in the 'usernames' collection
            try {
                const usernameDocRef = db.collection('usernames').doc(lowerIdentifier);
                const usernameDoc = await usernameDocRef.get();

                if (!usernameDoc.exists) {
                    throw new Error("Invalid details. Please check your username/email and password.");
                }

                const userId = usernameDoc.data()!.userId;
                const userProfile = await this.getUserProfileById(userId);

                if (!userProfile) {
                     throw new Error("User profile not found for this username.");
                }
                emailToSignIn = userProfile.email;

            } catch (error: any) {
                console.error("Firestore username lookup failed:", error);
                if (error.code === 'unavailable') {
                    throw new Error("You are offline. Please log in with your full email address, as usernames cannot be checked without a connection.");
                }
                throw new Error("Network error. Could not verify username.");
            }
        }

        try {
            await auth.signInWithEmailAndPassword(emailToSignIn, pass);
        } catch (authError) {
            console.error("Firebase Auth sign in error:", authError);
            throw new Error("Invalid details. Please check your username/email and password.");
        }
    },
    
    signOutUser: () => auth.signOut(),

    async isUsernameTaken(username: string): Promise<boolean> {
        // Checks a public collection 'usernames' where each doc ID is a username.
        // This is more secure as it doesn't require querying the private 'users' collection.
        const usernameDocRef = db.collection('usernames').doc(username.toLowerCase());
        const usernameDoc = await usernameDocRef.get();
        return usernameDoc.exists;
    },
    
    async getUserProfileById(uid: string): Promise<User | null> {
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        if (userDoc.exists) {
            return docToUser(userDoc);
        }
        return null;
    },

     async getUsersByIds(userIds: string[]): Promise<User[]> {
        if (userIds.length === 0) {
            return [];
        }
        const usersRef = db.collection('users');
        // Firestore 'in' query is limited to 10 items.
        // We need to batch the requests if there are more than 10.
        const userPromises: Promise<firebase.firestore.QuerySnapshot>[] = [];
        for (let i = 0; i < userIds.length; i += 10) {
            const chunk = userIds.slice(i, i + 10);
            userPromises.push(usersRef.where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get());
        }
        
        const userSnapshots = await Promise.all(userPromises);
        const users: User[] = [];
        userSnapshots.forEach(snapshot => {
            snapshot.docs.forEach(doc => {
                users.push(docToUser(doc));
            });
        });
        
        return users;
    },


    // --- Friends ---
    listenToFriends(userId: string, callback: (friends: User[]) => void) {
        const userRef = db.collection('users').doc(userId);
        return userRef.onSnapshot(async (userDoc) => {
            if (userDoc.exists) {
                const friendIds = userDoc.data()!.friendIds || [];
                if (friendIds.length === 0) {
                    callback([]);
                    return;
                }
                const friendPromises = friendIds.map(id => this.getUserProfileById(id));
                const friends = (await Promise.all(friendPromises)).filter(f => f !== null) as User[];
                
                // Mock online status for the demo
                const friendsWithStatus = friends.map((friend, index) => ({
                    ...friend,
                    onlineStatus: index % 3 === 0 ? 'online' : 'offline',
                }));
                callback(friendsWithStatus);
            } else {
                callback([]);
            }
        });
    },

    // --- Posts ---
    listenToFeedPosts(currentUserId: string, callback: (posts: Post[]) => void) {
        const q = db.collection('posts').orderBy('createdAt', 'desc').limit(50);
        return q.onSnapshot(async (snapshot) => {
            // Get user's friend list and blocked list for accurate filtering
            const userDoc = await db.collection('users').doc(currentUserId).get();
            const friendIds = userDoc.exists ? userDoc.data()!.friendIds || [] : [];
            const blockedUserIds = userDoc.exists ? userDoc.data()!.blockedUserIds || [] : [];
    
            const feedPosts = snapshot.docs.map(docToPost);
    
            const filtered = feedPosts.filter(p => {
                if (!p.author || !p.author.id) return false;
    
                // Don't show posts from users the current user has blocked.
                if (blockedUserIds.includes(p.author.id)) return false;
    
                // Show the user's own posts
                if (p.author.id === currentUserId) return true;
    
                // Show public posts
                if (p.author.privacySettings?.postVisibility === 'public') return true;
    
                // Show friends' posts if visibility is set to 'friends'
                if (friendIds.includes(p.author.id) && p.author.privacySettings?.postVisibility === 'friends') return true;
    
                return false;
            });
            callback(filtered);
        });
    },

    listenToExplorePosts(currentUserId: string, callback: (posts: Post[]) => void) {
        const q = db.collection('posts')
            .where('author.privacySettings.postVisibility', '==', 'public')
            .orderBy('createdAt', 'desc')
            .limit(50);
        return q.onSnapshot((snapshot) => {
            const explorePosts = snapshot.docs
                .map(docToPost)
                .filter(post => post.author.id !== currentUserId && !post.isSponsored); // Filter client-side
            callback(explorePosts);
        });
    },

    listenToReelsPosts(callback: (posts: Post[]) => void) {
        const q = db.collection('posts')
            .where('videoUrl', '!=', null)
            .orderBy('videoUrl')
            .orderBy('createdAt', 'desc')
            .limit(50);
        return q.onSnapshot((snapshot) => {
            const reelsPosts = snapshot.docs.map(docToPost);
            callback(reelsPosts);
        });
    },

    listenToPost(postId: string, callback: (post: Post | null) => void): () => void {
        const postRef = db.collection('posts').doc(postId);
        return postRef.onSnapshot((doc) => {
            if (doc.exists) {
                callback(docToPost(doc));
            } else {
                callback(null);
            }
        }, (error) => {
            console.error(`Error listening to post ${postId}:`, error);
            callback(null);
        });
    },

    async createPost(
        postData: any,
        media: {
            mediaFile?: File | null;
            audioBlobUrl?: string | null;
            generatedImageBase64?: string | null;
        }
    ) {
        const { author: user, ...restOfPostData } = postData;
        
        const authorInfo: Author = {
            id: user.id,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            privacySettings: user.privacySettings,
        };

        const postToSave: any = {
            ...restOfPostData,
            author: authorInfo,
            createdAt: serverTimestamp(),
            reactions: {},
            commentCount: 0,
            comments: [],
        };

        const userId = user.id;

        // Handle file upload (photo/video) via Cloudinary
        if (media.mediaFile) {
            const { url, type } = await uploadMediaToCloudinary(media.mediaFile, `post_${userId}_${Date.now()}`);
            if (type === 'video') {
                postToSave.videoUrl = url;
            } else {
                postToSave.imageUrl = url;
            }
        }
        
        // Handle AI generated image (base64 data URL)
        if (media.generatedImageBase64) {
            const blob = await fetch(media.generatedImageBase64).then(res => res.blob());
            const { url } = await uploadMediaToCloudinary(blob, `post_ai_${userId}_${Date.now()}.jpeg`);
            postToSave.imageUrl = url;
        }

        // Handle audio blob URL
        if (media.audioBlobUrl) {
            const audioBlob = await fetch(media.audioBlobUrl).then(r => r.blob());
            const { url } = await uploadMediaToCloudinary(audioBlob, `post_audio_${userId}_${Date.now()}.webm`);
            postToSave.audioUrl = url;
        }

        await db.collection('posts').add(postToSave);
    },

    async deletePost(postId: string, userId: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            const postDoc = await postRef.get();
            if (!postDoc.exists) {
                throw new Error("Post not found");
            }

            const postData = postDoc.data() as Post;

            // Security check: only the author can delete the post
            if (postData.author.id !== userId) {
                console.error("Permission denied: User is not the author of the post.");
                return false;
            }

            await postRef.delete();
            return true;

        } catch (error) {
            console.error("Error deleting post:", error);
            return false;
        }
    },
    
    async reactToPost(postId: string, userId: string, newReaction: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw "Post does not exist!";
    
                const postData = postDoc.data() as Post;
                // New data structure: { [userId]: emoji }
                const reactions = { ...(postData.reactions || {}) };
                
                const userPreviousReaction = reactions[userId];
    
                if (userPreviousReaction === newReaction) {
                    // User is toggling off their reaction.
                    delete reactions[userId];
                } else {
                    // User is adding a new reaction or changing their existing one.
                    reactions[userId] = newReaction;
                }
                
                transaction.update(postRef, { reactions });
            });
            return true;
        } catch (e) {
            console.error("Reaction transaction failed:", e);
            return false;
        }
    },

    async reactToComment(postId: string, commentId: string, userId: string, newReaction: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw "Post does not exist!";
    
                const postData = postDoc.data() as Post;
                const comments = postData.comments || [];
                const commentIndex = comments.findIndex(c => c.id === commentId);
    
                if (commentIndex === -1) throw "Comment not found!";
    
                const comment = comments[commentIndex];
                const reactions = { ...(comment.reactions || {}) };
                const userPreviousReaction = reactions[userId];
    
                if (userPreviousReaction === newReaction) {
                    // Toggling off
                    delete reactions[userId];
                } else {
                    // Adding or changing reaction
                    reactions[userId] = newReaction;
                }
                
                comments[commentIndex].reactions = reactions;
    
                transaction.update(postRef, { comments });
            });
            return true;
        } catch (e) {
            console.error("React to comment transaction failed:", e);
            return false;
        }
    },
    
// @FIXML-FIX-613: Added parentId to the data type
    async createComment(user: User, postId: string, data: { text?: string; imageFile?: File; audioBlob?: Blob; duration?: number; parentId?: string | null }): Promise<Comment | null> {
        if (user.commentingSuspendedUntil && new Date(user.commentingSuspendedUntil) > new Date()) {
            console.warn(`User ${user.id} is suspended from commenting.`);
            return null;
        }
    
        const postRef = db.collection('posts').doc(postId);
    
        const newComment: any = {
            id: db.collection('posts').doc().id, // Pre-generate ID for file naming
            postId,
            author: {
                id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl,
            },
            createdAt: Timestamp.now(),
            reactions: {},
// @FIXML-FIX-613: Added parentId to the new comment object
            parentId: data.parentId || null,
        };
    
        if (data.audioBlob && data.duration) {
            newComment.type = 'audio';
            newComment.duration = data.duration;
            const { url } = await uploadMediaToCloudinary(data.audioBlob, `comment_audio_${newComment.id}.webm`);
            newComment.audioUrl = url;
        } else if (data.imageFile) {
            newComment.type = 'image';
            const { url } = await uploadMediaToCloudinary(data.imageFile, `comment_image_${newComment.id}.jpeg`);
            newComment.imageUrl = url;
        } else if (data.text) {
            newComment.type = 'text';
            newComment.text = data.text;
        } else {
            throw new Error("Comment must have content.");
        }
        
        await postRef.update({
            comments: arrayUnion(newComment),
            commentCount: increment(1),
        });
        
        return {
            ...newComment,
            createdAt: new Date().toISOString()
        } as Comment;
    },

// @FIXML-FIX-619: Add editComment function
    async editComment(postId: string, commentId: string, newText: string): Promise<void> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw "Post does not exist!";
    
                const postData = postDoc.data() as Post;
                const comments = [...postData.comments] || [];
                const commentIndex = comments.findIndex(c => c.id === commentId);
    
                if (commentIndex === -1) throw "Comment not found!";
    
                comments[commentIndex].text = newText;
                comments[commentIndex].updatedAt = new Date().toISOString();
    
                transaction.update(postRef, { comments });
            });
        } catch (e) {
            console.error("Edit comment transaction failed:", e);
        }
    },

// @FIXML-FIX-624: Add deleteComment function
    async deleteComment(postId: string, commentId: string): Promise<void> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw "Post does not exist!";
    
                const postData = postDoc.data() as Post;
                const comments = [...postData.comments] || [];
                const commentIndex = comments.findIndex(c => c.id === commentId);

                if (commentIndex === -1) return; // Comment already deleted

                // Soft delete
                comments[commentIndex].isDeleted = true;
                comments[commentIndex].text = undefined;
                comments[commentIndex].audioUrl = undefined;
                comments[commentIndex].imageUrl = undefined;
                comments[commentIndex].reactions = {};

                transaction.update(postRef, { comments });
            });
        } catch (e) {
            console.error("Delete comment transaction failed:", e);
        }
    },

    async voteOnPoll(userId: string, postId: string, optionIndex: number): Promise<Post | null> {
        const postRef = db.collection('posts').doc(postId);
        try {
            let updatedPostData: Post | null = null;
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) {
                    throw "Post does not exist!";
                }
    
                const postData = postDoc.data() as Post;
                if (!postData.poll) {
                    throw "This post does not have a poll.";
                }
    
                const hasVoted = postData.poll.options.some(opt => opt.votedBy.includes(userId));
                if (hasVoted) {
                    updatedPostData = docToPost(postDoc);
                    return;
                }
    
                if (optionIndex < 0 || optionIndex >= postData.poll.options.length) {
                    throw "Invalid poll option index.";
                }
    
                const updatedOptions = postData.poll.options.map((option, index) => {
                    if (index === optionIndex) {
                        return {
                            ...option,
                            votes: option.votes + 1,
                            votedBy: [...option.votedBy, userId],
                        };
                    }
                    return option;
                });
    
                const updatedPoll = { ...postData.poll, options: updatedOptions };
                transaction.update(postRef, { poll: updatedPoll });
                
                updatedPostData = { ...docToPost(postDoc), poll: updatedPoll };
            });
            return updatedPostData;
        } catch (e) {
            console.error("Vote on poll transaction failed:", e);
            return null;
        }
    },

    async markBestAnswer(userId: string, postId: string, commentId: string): Promise<Post | null> {
        const postRef = db.collection('posts').doc(postId);
        try {
            const postDoc = await postRef.get();
            if (!postDoc.exists) {
                throw "Post does not exist!";
            }
            const postData = postDoc.data() as Post;
    
            if (postData.author.id !== userId) {
                console.error("Permission denied. User is not the author.");
                return null;
            }
            
            const commentExists = postData.comments.some(c => c.id === commentId);
            if (!commentExists) {
                 throw "Comment does not exist on this post.";
            }
    
            await postRef.update({ bestAnswerId: commentId });
            
            const updatedPostDoc = await postRef.get();
            return docToPost(updatedPostDoc);
        } catch (e) {
            console.error("Marking best answer failed:", e);
            return null;
        }
    },

    // --- Profile & Security ---
    async getUserProfile(username: string): Promise<User | null> {
        const q = db.collection('users').where('username', '==', username.toLowerCase()).limit(1);
        const userQuery = await q.get();
        if (!userQuery.empty) {
            return docToUser(userQuery.docs[0]);
        }
        return null;
    },

    async getPostsByUser(userId: string): Promise<Post[]> {
        const q = db.collection('posts').where('author.id', '==', userId).orderBy('createdAt', 'desc');
        const postQuery = await q.get();
        return postQuery.docs.map(docToPost);
    },
    
    async updateProfile(userId: string, updates: Partial<User>): Promise<void> {
        const userRef = db.collection('users').doc(userId);
        const updatesToSave = { ...updates };
    
        if (updates.name) {
            updatesToSave.name_lowercase = updates.name.toLowerCase();
        }
    
        try {
            await userRef.update(updatesToSave);
        } catch (error) {
            console.error("Error updating user profile in Firebase:", error);
            throw error;
        }
    },

    async updateProfilePicture(userId: string, base64Url: string, caption?: string, captionStyle?: Post['captionStyle']): Promise<{ updatedUser: User; newPost: Post } | null> {
        const userRef = db.collection('users').doc(userId);
        try {
            const blob = await fetch(base64Url).then(res => res.blob());
            const { url: newAvatarUrl } = await uploadMediaToCloudinary(blob, `avatar_${userId}_${Date.now()}.jpeg`);

            await userRef.update({ avatarUrl: newAvatarUrl });

            const userDoc = await userRef.get();
            if (!userDoc.exists) return null;
            const user = docToUser(userDoc);

            const authorInfo: Author = {
                id: user.id,
                name: user.name,
                username: user.username,
                avatarUrl: newAvatarUrl,
                privacySettings: user.privacySettings,
            };

            const newPostData = {
                author: authorInfo,
                caption: caption || `${user.name.split(' ')[0]} updated their profile picture.`,
                captionStyle: captionStyle,
                createdAt: serverTimestamp(),
                postType: 'profile_picture_change',
                newPhotoUrl: newAvatarUrl,
                reactions: {},
                commentCount: 0,
                comments: [],
                duration: 0,
            };

            const postRef = await db.collection('posts').add(newPostData);
            const newPostDoc = await postRef.get();
            const newPost = docToPost(newPostDoc);

            const updatedUser = { ...user, avatarUrl: newAvatarUrl };
            return { updatedUser, newPost };

        } catch (error) {
            console.error("Error updating profile picture:", error);
            return null;
        }
    },

    async updateCoverPhoto(userId: string, base64Url: string, caption?: string, captionStyle?: Post['captionStyle']): Promise<{ updatedUser: User; newPost: Post } | null> {
        const userRef = db.collection('users').doc(userId);
        try {
            const blob = await fetch(base64Url).then(res => res.blob());
            const { url: newCoverUrl } = await uploadMediaToCloudinary(blob, `cover_${userId}_${Date.now()}.jpeg`);

            await userRef.update({ coverPhotoUrl: newCoverUrl });

            const userDoc = await userRef.get();
            if (!userDoc.exists) return null;
            const user = docToUser(userDoc);

            const authorInfo: Author = {
                id: user.id,
                name: user.name,
                username: user.username,
                avatarUrl: user.avatarUrl,
                privacySettings: user.privacySettings,
            };

            const newPostData = {
                author: authorInfo,
                caption: caption || `${user.name.split(' ')[0]} updated their cover photo.`,
                captionStyle: captionStyle,
                createdAt: serverTimestamp(),
                postType: 'cover_photo_change',
                newPhotoUrl: newCoverUrl,
                reactions: {},
                commentCount: 0,
                comments: [],
                duration: 0,
            };

            const postRef = await db.collection('posts').add(newPostData);
            const newPostDoc = await postRef.get();
            const newPost = docToPost(newPostDoc);

            const updatedUser = { ...user, coverPhotoUrl: newCoverUrl };
            return { updatedUser, newPost };

        } catch (error) {
            console.error("Error updating cover photo:", error);
            return null;
        }
    },
    
     async searchUsers(query: string): Promise<User[]> {
        const lowerQuery = query.toLowerCase();
        const nameQuery = db.collection('users').where('name_lowercase', '>=', lowerQuery).where('name_lowercase', '<=', lowerQuery + '\uf8ff');
        const usernameQuery = db.collection('users').where('username', '>=', lowerQuery).where('username', '<=', lowerQuery + '\uf8ff');
        
        const [nameSnapshot, usernameSnapshot] = await Promise.all([nameQuery.get(), usernameQuery.get()]);
        
        const results = new Map<string, User>();
        nameSnapshot.docs.forEach(d => results.set(d.id, docToUser(d)));
        usernameSnapshot.docs.forEach(d => results.set(d.id, docToUser(d)));
        
        return Array.from(results.values());
    },

    async blockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
        const currentUserRef = db.collection('users').doc(currentUserId);
        const targetUserRef = db.collection('users').doc(targetUserId);
        try {
            await db.runTransaction(async (transaction) => {
                transaction.update(currentUserRef, { blockedUserIds: arrayUnion(targetUserId) });
                transaction.update(targetUserRef, { blockedUserIds: arrayUnion(currentUserId) });
            });
            return true;
        } catch (error) {
            console.error("Failed to block user:", error);
            return false;
        }
    },

    async unblockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
        const currentUserRef = db.collection('users').doc(currentUserId);
        const targetUserRef = db.collection('users').doc(targetUserId);
        try {
            await db.runTransaction(async (transaction) => {
                transaction.update(currentUserRef, { blockedUserIds: arrayRemove(targetUserId) });
                transaction.update(targetUserRef, { blockedUserIds: arrayRemove(currentUserId) });
            });
            return true;
        } catch (error) {
            console.error("Failed to unblock user:", error);
            return false;
        }
    },

    async deactivateAccount(userId: string): Promise<boolean> {
        const userRef = db.collection('users').doc(userId);
        try {
            await userRef.update({ isDeactivated: true });
            return true;
        } catch (error) {
            console.error("Failed to deactivate account:", error);
            return false;
        }
    },

    // --- Voice Coins ---
    async updateVoiceCoins(userId: string, amount: number): Promise<boolean> {
        const userRef = db.collection('users').doc(userId);
        try {
            await userRef.update({
                voiceCoins: increment(amount)
            });
            return true;
        } catch (e) {
            console.error("Failed to update voice coins:", e);
            return false;
        }
    },
    
    // --- Rooms ---
    listenToLiveAudioRooms(callback: (rooms: LiveAudioRoom[]) => void) {
        const q = db.collection('liveAudioRooms').where('status', '==', 'live');
        return q.onSnapshot((snapshot) => {
            const rooms = snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                } as LiveAudioRoom;
            });
            callback(rooms);
        });
    },

    listenToLiveVideoRooms(callback: (rooms: LiveVideoRoom[]) => void) {
        const q = db.collection('liveVideoRooms').where('status', '==', 'live');
        return q.onSnapshot((snapshot) => {
            const rooms = snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                } as LiveVideoRoom;
            });
            callback(rooms);
        });
    },

    listenToRoom(roomId: string, type: 'audio' | 'video', callback: (room: LiveAudioRoom | LiveVideoRoom | null) => void) {
        const collectionName = type === 'audio' ? 'liveAudioRooms' : 'liveVideoRooms';
        return db.collection(collectionName).doc(roomId).onSnapshot((d) => {
            if (d.exists) {
                const data = d.data();
                const roomData = { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                };
                callback(roomData as LiveAudioRoom | LiveVideoRoom);
            } else {
                callback(null); // Room doesn't exist or was deleted
            }
        });
    },

     // --- Messages ---
    listenToMessages(chatId: string, callback: (messages: Message[]) => void) {
        const q = db.collection('chats').doc(chatId).collection('messages').orderBy('createdAt', 'asc');
        return q.onSnapshot((snapshot) => {
            const messages = snapshot.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString()
                } as Message;
            });
            callback(messages);
        });
    },
    
    async sendMessage(chatId: string, message: Omit<Message, 'id' | 'createdAt'>) {
         const messageWithTimestamp = {
            ...message,
            createdAt: serverTimestamp(),
        };
        await db.collection('chats').doc(chatId).collection('messages').add(messageWithTimestamp);
    },

    // --- Stories ---
    async createStory(
        storyData: Omit<Story, 'id' | 'createdAt' | 'duration' | 'contentUrl' | 'viewedBy'>,
        mediaFile: File | null
    ): Promise<Story> {
        const storyToSave: any = {
            ...storyData,
            author: { // Denormalize author data for reads
                id: storyData.author.id,
                name: storyData.author.name,
                avatarUrl: storyData.author.avatarUrl,
                username: storyData.author.username,
            },
            createdAt: serverTimestamp(),
            viewedBy: [],
        };
    
        let duration = 5; // default for text/image
    
        // If there's a media file (image or video), upload it
        if (mediaFile) {
            const { url, type } = await uploadMediaToCloudinary(mediaFile, `story_${storyData.author.id}_${Date.now()}`);
            storyToSave.contentUrl = url;
            
            if (type === 'video') {
                duration = 15; 
            }
        } else if (storyData.contentUrl) { // Handle mock gallery items that pass a URL directly
             const isVideo = storyData.contentUrl.endsWith('.mp4');
             if (isVideo) duration = 15;
        }
        
        storyToSave.duration = duration;
    
        const docRef = await db.collection('stories').add(storyToSave);
        
        const createdStory: Story = {
            id: docRef.id,
            ...storyData,
            createdAt: new Date().toISOString(),
            duration: duration,
            contentUrl: storyToSave.contentUrl || storyData.contentUrl,
            viewedBy: [],
        };
        return createdStory;
    },

    // --- Group Member Management ---
    async promoteGroupMember(groupId: string, userToPromote: User, newRole: 'Admin' | 'Moderator'): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        const fieldToUpdate = newRole === 'Admin' ? 'admins' : 'moderators';
        try {
            const userRefOnly = { id: userToPromote.id, name: userToPromote.name, avatarUrl: userToPromote.avatarUrl, username: userToPromote.username };
            await groupRef.update({
                [fieldToUpdate]: arrayUnion(userRefOnly)
            });
            // If they were a moderator and are now an admin, remove them from moderators
            if (newRole === 'Admin') {
                await groupRef.update({
                    moderators: arrayRemove(userRefOnly)
                });
            }
            return true;
        } catch (error) {
            console.error(`Failed to promote ${userToPromote.name} to ${newRole}:`, error);
            return false;
        }
    },

    async demoteGroupMember(groupId: string, userToDemote: User, oldRole: 'Admin' | 'Moderator'): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        const fieldToUpdate = oldRole === 'Admin' ? 'admins' : 'moderators';
        try {
             const userRefOnly = { id: userToDemote.id, name: userToDemote.name, avatarUrl: userToDemote.avatarUrl, username: userToDemote.username };
            await groupRef.update({
                [fieldToUpdate]: arrayRemove(userRefOnly)
            });
            return true;
        } catch (error) {
            console.error(`Failed to demote ${userToDemote.name}:`, error);
            return false;
        }
    },
    
    async removeGroupMember(groupId: string, userToRemove: User): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            const userRefOnly = { id: userToRemove.id, name: userToRemove.name, avatarUrl: userToRemove.avatarUrl, username: userToRemove.username };
            await groupRef.update({
                members: arrayRemove(userRefOnly),
                admins: arrayRemove(userRefOnly),
                moderators: arrayRemove(userRefOnly),
                memberCount: increment(-1)
            });
            return true;
        } catch (error) {
            console.error(`Failed to remove ${userToRemove.name} from group:`, error);
            return false;
        }
    },

    // --- Group Request/Post Management ---
    async approveJoinRequest(groupId: string, userId: string): Promise<void> {
        const groupRef = db.collection('groups').doc(groupId);
        const user = await this.getUserProfileById(userId);
        if (!user) throw new Error("User to be approved not found.");

        try {
            await db.runTransaction(async (transaction) => {
                const groupDoc = await transaction.get(groupRef);
                if (!groupDoc.exists) throw "Group does not exist!";
                
                const groupData = groupDoc.data() as Group;
                
                const requestToRemove = (groupData.joinRequests || []).find(req => req.user.id === userId);
                const isAlreadyMember = groupData.members.some(m => m.id === userId);

                transaction.update(groupRef, {
                    joinRequests: requestToRemove ? arrayRemove(requestToRemove) : groupData.joinRequests,
                    members: isAlreadyMember ? groupData.members : arrayUnion(user),
                    memberCount: isAlreadyMember ? groupData.memberCount : increment(1)
                });
            });
        } catch (e) {
            console.error("Approve join request transaction failed:", e);
        }
    },

    async rejectJoinRequest(groupId: string, userId: string): Promise<void> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            await db.runTransaction(async (transaction) => {
                const groupDoc = await transaction.get(groupRef);
                if (!groupDoc.exists) throw "Group does not exist!";
                
                const groupData = groupDoc.data() as Group;
                const requestToRemove = (groupData.joinRequests || []).find(req => req.user.id === userId);

                if (requestToRemove) {
                     transaction.update(groupRef, {
                        joinRequests: arrayRemove(requestToRemove)
                    });
                }
            });
        } catch (e) {
            console.error("Reject join request transaction failed:", e);
        }
    },
    
    async approvePost(postId: string): Promise<void> {
        const postRef = db.collection('posts').doc(postId);
        try {
            const postDoc = await postRef.get();
            if (!postDoc.exists) throw "Post does not exist!";
            const postData = postDoc.data() as Post;
            const groupId = postData.groupId;
            if (!groupId) return;

            // Remove from pendingPosts array on group doc
            const groupRef = db.collection('groups').doc(groupId);
            const groupDoc = await groupRef.get();
            if (groupDoc.exists) {
                const groupData = groupDoc.data() as Group;
                const postToRemove = (groupData.pendingPosts || []).find(p => p.id === postId);
                if (postToRemove) {
                    await groupRef.update({
                        pendingPosts: arrayRemove(postToRemove)
                    });
                }
            }
            
            // Update post status
            await postRef.update({ status: 'approved' });
        } catch (e) {
            console.error("Approve post failed:", e);
        }
    },

    async rejectPost(postId: string): Promise<void> {
        const postRef = db.collection('posts').doc(postId);
        try {
             const postDoc = await postRef.get();
            if (!postDoc.exists) return;
            const postData = postDoc.data() as Post;
            const groupId = postData.groupId;

            // Remove from pendingPosts array on group doc
            if (groupId) {
                 const groupRef = db.collection('groups').doc(groupId);
                 const groupDoc = await groupRef.get();
                 if (groupDoc.exists) {
                    const groupData = groupDoc.data() as Group;
                    const postToRemove = (groupData.pendingPosts || []).find(p => p.id === postId);
                    if (postToRemove) {
                        await groupRef.update({
                            pendingPosts: arrayRemove(postToRemove)
                        });
                    }
                 }
            }
            
            // Actually delete the post document
            await postRef.delete();
        } catch (e) {
            console.error("Reject post failed:", e);
        }
    },

    // --- Admin Panel Functions ---
    async getAdminDashboardStats() {
        const usersColl = db.collection('users');
        const postsColl = db.collection('posts');
        const campaignsColl = db.collection('campaigns');
        const reportsColl = db.collection('reports');
    
        // 1. Get total users
        const usersSnapshot = await usersColl.get();
        const totalUsers = usersSnapshot.size;
    
        // 2. New users today
        const twentyFourHoursAgo = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
        const newUsersQuery = usersColl.where('createdAt', '>=', twentyFourHoursAgo);
        const newUsersSnapshot = await newUsersQuery.get();
        const newUsersToday = newUsersSnapshot.size;
    
        // 3. Posts in last 24h
        const newPostsQuery = postsColl.where('createdAt', '>=', twentyFourHoursAgo);
        const newPostsSnapshot = await newPostsQuery.get();
        const postsLast24h = newPostsSnapshot.size;
    
        // 4. Pending campaigns
        const pendingCampaignsQuery = campaignsColl.where('status', '==', 'pending');
        const pendingCampaignsSnapshot = await pendingCampaignsQuery.get();
        const pendingCampaigns = pendingCampaignsSnapshot.size;
    
        // 5. Active users
        const fiveMinutesAgo = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
        const activeUsersQuery = usersColl.where('lastActiveTimestamp', '>=', fiveMinutesAgo);
        const activeUsersSnapshot = await activeUsersQuery.get();
        const activeUsersNow = activeUsersSnapshot.size;
    
        // 6. Pending reports
        const pendingReportsQuery = reportsColl.where('status', '==', 'pending');
        const pendingReportsSnapshot = await pendingReportsQuery.get();
        const pendingReports = pendingReportsSnapshot.size;
        
        // 7. Pending payments
        const pendingPaymentsQuery = campaignsColl.where('paymentStatus', '==', 'pending');
        const pendingPaymentsSnapshot = await pendingPaymentsQuery.get();
        const pendingPayments = pendingPaymentsSnapshot.size;

        return {
            totalUsers,
            newUsersToday,
            postsLast24h,
            pendingCampaigns,
            activeUsersNow,
            pendingReports,
            pendingPayments,
        };
    },

    async getAllUsersForAdmin(): Promise<User[]> {
        const usersSnapshot = await db.collection('users').get();
        return usersSnapshot.docs.map(docToUser);
    },

    async banUser(userId: string): Promise<boolean> {
        try {
            await db.collection('users').doc(userId).update({ isBanned: true });
            return true;
        } catch (e) {
            console.error("Failed to ban user:", e);
            return false;
        }
    },

    async unbanUser(userId: string): Promise<boolean> {
        try {
            await db.collection('users').doc(userId).update({ isBanned: false });
            return true;
        } catch (e) {
            console.error("Failed to unban user:", e);
            return false;
        }
    },
    
    async suspendUserCommenting(userId: string, days: number): Promise<boolean> {
        try {
            const suspensionEndDate = new Date();
            suspensionEndDate.setDate(suspensionEndDate.getDate() + days);
            await db.collection('users').doc(userId).update({
                commentingSuspendedUntil: suspensionEndDate.toISOString()
            });
            return true;
        } catch (e) {
            console.error("Failed to suspend user commenting:", e);
            return false;
        }
    },

    async liftUserCommentingSuspension(userId: string): Promise<boolean> {
        try {
            // Setting to null effectively removes the suspension
            await db.collection('users').doc(userId).update({
                commentingSuspendedUntil: null 
            });
            return true;
        } catch (e) {
            console.error("Failed to lift user commenting suspension:", e);
            return false;
        }
    },

    async getPendingCampaigns(): Promise<Campaign[]> {
        const q = db.collection('campaigns').where('status', '==', 'pending');
        const snapshot = await q.get();
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Campaign));
    },

    async approveCampaign(campaignId: string): Promise<void> {
        await db.collection('campaigns').doc(campaignId).update({ status: 'active' });
    },

    async rejectCampaign(campaignId: string, reason: string): Promise<void> {
        await db.collection('campaigns').doc(campaignId).update({ status: 'rejected', rejectionReason: reason });
    },
    
    async getAllPostsForAdmin(): Promise<Post[]> {
        const q = db.collection('posts').orderBy('createdAt', 'desc');
        const postQuery = await q.get();
        return postQuery.docs.map(docToPost);
    },

    async deletePostAsAdmin(postId: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await postRef.delete();
            // In a real app, also delete associated media from storage.
            return true;
        } catch (error) {
            console.error("Error deleting post as admin:", error);
            return false;
        }
    },

    async deleteCommentAsAdmin(commentId: string, postId: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await db.runTransaction(async (transaction) => {
                const postDoc = await transaction.get(postRef);
                if (!postDoc.exists) throw "Post not found";
                const postData = postDoc.data() as Post;
                const comments = postData.comments || [];
                const updatedComments = comments.filter(c => c.id !== commentId);
                
                if (comments.length === updatedComments.length) {
                    console.warn(`Comment ${commentId} not found on post ${postId}.`);
                    return; // No change needed
                }
                
                transaction.update(postRef, {
                    comments: updatedComments,
                    commentCount: increment(-1)
                });
            });
            return true;
        } catch (error) {
            console.error("Error deleting comment as admin:", error);
            return false;
        }
    },
    
    async getPostById(postId: string): Promise<Post | null> {
        const postDoc = await db.collection('posts').doc(postId).get();
        if (postDoc.exists) {
            return docToPost(postDoc);
        }
        return null;
    },
    
    async updateUserLastActive(userId: string): Promise<void> {
        const userRef = db.collection('users').doc(userId);
        try {
            await userRef.set({ lastActiveTimestamp: serverTimestamp() }, { merge: true });
        } catch (error) {
            console.error("Failed to update last active timestamp. This may be a Firestore security rule issue.", error);
        }
    },

    async getPendingReports(): Promise<Report[]> {
        const q = db.collection('reports').where('status', '==', 'pending').orderBy('createdAt', 'desc');
        const snapshot = await q.get();
        return snapshot.docs.map(d => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt instanceof firebase.firestore.Timestamp ? d.data().createdAt.toDate().toISOString() : new Date().toISOString(),
        } as Report));
    },

    async resolveReport(reportId: string, resolution: string): Promise<void> {
        const reportRef = db.collection('reports').doc(reportId);
        await reportRef.update({
            status: 'resolved',
            resolution: resolution,
            resolvedAt: serverTimestamp(),
        });
    },

    // New functions for tiered moderation
    async warnUser(userId: string, message: string): Promise<boolean> {
        try {
            // Using a notification for simplicity. A dedicated 'warnings' subcollection would also be a good approach.
            const userNotifsRef = db.collection('users').doc(userId).collection('notifications');
            await userNotifsRef.add({
                type: 'admin_warning',
                message,
                read: false,
                createdAt: serverTimestamp(),
                // Admin user info is not readily available client-side, so we use a system representation.
                user: { id: 'system', name: 'Admin Team', avatarUrl: DEFAULT_AVATARS[0], username: 'admin' }
            });
            return true;
        } catch (error) {
            console.error("Failed to warn user:", error);
            return false;
        }
    },

    async suspendUserPosting(userId: string, days: number): Promise<boolean> {
        try {
            const suspensionEndDate = new Date();
            suspensionEndDate.setDate(suspensionEndDate.getDate() + days);
            await db.collection('users').doc(userId).update({
                postingSuspendedUntil: suspensionEndDate.toISOString()
            });
            return true;
        } catch (e) {
            console.error("Failed to suspend user posting:", e);
            return false;
        }
    },

    async liftUserPostingSuspension(userId: string): Promise<boolean> {
        try {
            await db.collection('users').doc(userId).update({ postingSuspendedUntil: null });
            return true;
        } catch (e) {
            console.error("Failed to lift user posting suspension:", e);
            return false;
        }
    },

    async getUserDetailsForAdmin(userId: string) {
        const user = await this.getUserProfileById(userId);
        if (!user) return null;

        // Get user's own posts
        const postsSnapshot = await db.collection('posts').where('author.id', '==', userId).orderBy('createdAt', 'desc').limit(10).get();
        const posts = postsSnapshot.docs.map(docToPost);

        // Get reports against the user
        const reportsSnapshot = await db.collection('reports').where('reportedUserId', '==', userId).orderBy('createdAt', 'desc').limit(10).get();
        const reports = reportsSnapshot.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate().toISOString() || new Date().toISOString(),
        } as Report));
        
        // Get user's comments (inefficient scan, acceptable for a limited-scope admin tool)
        // This is a known limitation due to the denormalized data structure.
        const recentPostsSnapshot = await db.collection('posts').orderBy('createdAt', 'desc').limit(100).get();
        const comments: Comment[] = [];
        recentPostsSnapshot.docs.forEach(doc => {
            const post = doc.data() as Post;
            if (post.comments && Array.isArray(post.comments)) {
                post.comments.forEach(comment => {
                    if (comment.author.id === userId && comments.length < 10) {
                        comments.push(comment);
                    }
                });
            }
        });

        return { user, posts, comments, reports };
    },
    
    async sendSiteWideAnnouncement(message: string): Promise<boolean> {
        try {
            const usersSnapshot = await db.collection('users').get();
            if (usersSnapshot.empty) {
                return true; // No users to notify
            }

            const batch = db.batch();
            const adminUserRef = { id: 'system', name: 'VoiceBook Team', avatarUrl: DEFAULT_AVATARS[0], username: 'admin' };

            usersSnapshot.docs.forEach(userDoc => {
                const userNotifsRef = db.collection('users').doc(userDoc.id).collection('notifications').doc();
                batch.set(userNotifsRef, {
                    type: 'admin_announcement',
                    message: message,
                    read: false,
                    createdAt: serverTimestamp(),
                    user: adminUserRef
                });
            });

            await batch.commit();
            return true;
        } catch (error) {
            console.error("Failed to send site-wide announcement:", error);
            return false;
        }
    },

    async submitCampaignForApproval(campaignData: Omit<Campaign, 'id' | 'views' | 'clicks' | 'status' | 'transactionId'>, transactionId: string): Promise<void> {
        const campaignToSave: Omit<Campaign, 'id'> = {
            ...campaignData,
            views: 0,
            clicks: 0,
            status: 'pending',
            transactionId,
        };
        await db.collection('campaigns').add(campaignToSave);
    },

    async getAllCampaignsForAdmin(): Promise<Campaign[]> {
        const snapshot = await db.collection('campaigns').orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt instanceof firebase.firestore.Timestamp ? doc.data().createdAt.toDate().toISOString() : new Date().toISOString(),
            paymentVerifiedAt: doc.data().paymentVerifiedAt instanceof firebase.firestore.Timestamp ? doc.data().paymentVerifiedAt.toDate().toISOString() : undefined,
        } as Campaign));
    },

    async verifyCampaignPayment(campaignId: string, adminId: string): Promise<boolean> {
        const campaignRef = db.collection('campaigns').doc(campaignId);
        try {
            await campaignRef.update({
                paymentStatus: 'verified',
                paymentVerifiedBy: adminId,
                paymentVerifiedAt: serverTimestamp()
            });
            return true;
        } catch (error) {
            console.error("Failed to verify campaign payment:", error);
            return false;
        }
    },
    
    // --- Notifications ---
    listenToNotifications(userId: string, callback: (notifications: Notification[]) => void): () => void {
        const notificationsRef = db.collection('users').doc(userId).collection('notifications').orderBy('createdAt', 'desc').limit(30);
        return notificationsRef.onSnapshot(snapshot => {
          const notifs = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            } as Notification;
          });
          callback(notifs);
        });
    },

    async markNotificationsAsRead(userId: string, notificationIds: string[]): Promise<void> {
        if (notificationIds.length === 0) return;
        const batch = db.batch();
        const notificationsRef = db.collection('users').doc(userId).collection('notifications');
        notificationIds.forEach(id => {
          batch.update(notificationsRef.doc(id), { read: true });
        });
        try {
             await batch.commit();
        } catch(error) {
            console.error("Error marking notifications as read:", error);
        }
    },
    
    async trackAdView(campaignId: string): Promise<void> {
        const campaignRef = db.collection('campaigns').doc(campaignId);
        try {
            await db.runTransaction(async (transaction) => {
                const campaignDoc = await transaction.get(campaignRef);
                if (!campaignDoc.exists) return;
    
                const campaignData = campaignDoc.data() as Campaign;
                
                if (campaignData.status !== 'active') return;
    
                transaction.update(campaignRef, { views: increment(1) });
                
                const newViews = (campaignData.views || 0) + 1;
                const costSoFar = (newViews / 1000) * SPONSOR_CPM_BDT;
    
                if (costSoFar >= campaignData.budget) {
                    transaction.update(campaignRef, { status: 'finished' });
                }
            });
        } catch (error) {
            console.error("Failed to track ad view and check budget:", error);
        }
    },
    
    async trackAdClick(campaignId: string): Promise<void> {
        const campaignRef = db.collection('campaigns').doc(campaignId);
        try {
            await campaignRef.update({
                clicks: increment(1)
            });
        } catch (error) {
            console.error("Failed to track ad click:", error);
            // Fail silently, as this is a background task and shouldn't block the user.
        }
    },

    async submitLead(leadData: Omit<Lead, 'id'>): Promise<Lead> {
        const leadToSave = {
            ...leadData,
            createdAt: serverTimestamp(),
        };
        const docRef = await db.collection('leads').add(leadToSave);
        return {
            id: docRef.id,
            ...leadData,
            createdAt: new Date().toISOString(), // Return client-side version for immediate use
        };
    },

    async getLeadsForCampaign(campaignId: string): Promise<Lead[]> {
        const q = db.collection('leads').where('campaignId', '==', campaignId).orderBy('createdAt', 'desc');
        const snapshot = await q.get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            } as Lead;
        });
    },

    async getInjectableAd(currentUser: User): Promise<Post | null> {
        try {
            const q = db.collection('campaigns')
                .where('status', '==', 'active')
                .where('adType', '==', 'feed');
            
            const snapshot = await q.get();
            if (snapshot.empty) return null;

            const allCampaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
            
            const matchingCampaigns = allCampaigns.filter(c => 
                c.sponsorId !== currentUser.id && matchesTargeting(c, currentUser)
            );

            if (matchingCampaigns.length === 0) {
                console.log("No ad campaigns matched targeting for user:", currentUser.id);
                return null;
            }

            const randomCampaign = matchingCampaigns[Math.floor(Math.random() * matchingCampaigns.length)];

            const sponsorProfile = await this.getUserProfileById(randomCampaign.sponsorId);
            if (!sponsorProfile) {
                console.warn(`Sponsor profile not found for campaign ${randomCampaign.id}`);
                return null;
            }
            
            const adPost: Post = {
                id: `ad_${randomCampaign.id}`,
                author: {
                    id: sponsorProfile.id,
                    name: sponsorProfile.name,
                    username: sponsorProfile.username,
                    avatarUrl: sponsorProfile.avatarUrl,
                },
                caption: randomCampaign.caption,
                createdAt: new Date().toISOString(),
                imageUrl: randomCampaign.imageUrl,
                videoUrl: randomCampaign.videoUrl,
                audioUrl: randomCampaign.audioUrl,
                isSponsored: true,
                sponsorName: randomCampaign.sponsorName,
                campaignId: randomCampaign.id,
                sponsorId: randomCampaign.sponsorId,
                websiteUrl: randomCampaign.websiteUrl,
                allowDirectMessage: randomCampaign.allowDirectMessage,
                allowLeadForm: randomCampaign.allowLeadForm,
                duration: 0,
                commentCount: 0,
                comments: [],
                reactions: {},
            };

            return adPost;

        } catch (error) {
            console.error("Error fetching injectable ad:", error);
            return null;
        }
    },
    
    async getInjectableStoryAd(currentUser: User): Promise<Story | null> {
        try {
            const q = db.collection('campaigns')
                .where('status', '==', 'active')
                .where('adType', '==', 'story');
    
            const snapshot = await q.get();
            if (snapshot.empty) return null;
    
            const allCampaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
            
            const matchingCampaigns = allCampaigns.filter(c => 
                c.sponsorId !== currentUser.id && matchesTargeting(c, currentUser)
            );
    
            if (matchingCampaigns.length === 0) return null;
    
            const randomCampaign = matchingCampaigns[Math.floor(Math.random() * matchingCampaigns.length)];
            const sponsorProfile = await this.getUserProfileById(randomCampaign.sponsorId);
            if (!sponsorProfile) return null;
    
            const adStory: Story = {
                id: `ad_story_${randomCampaign.id}`,
                author: sponsorProfile,
                createdAt: new Date().toISOString(),
                type: randomCampaign.videoUrl ? 'video' : 'image',
                contentUrl: randomCampaign.videoUrl || randomCampaign.imageUrl,
                duration: 15,
                isSponsored: true,
                sponsorName: randomCampaign.sponsorName,
                sponsorAvatar: sponsorProfile.avatarUrl,
                campaignId: randomCampaign.id,
                ctaLink: randomCampaign.websiteUrl,
                viewedBy: [],
                privacy: 'public',
            };
    
            return adStory;
    
        } catch (error) {
            console.error("Error fetching injectable story ad:", error);
            return null;
        }
    },
};
