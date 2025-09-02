// @ts-nocheck
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { User as FirebaseUser } from 'firebase/auth';

import { db, auth, storage } from './firebaseConfig';
import { User, Post, Comment, Message, ReplyInfo, Story, Group, Campaign, LiveAudioRoom, LiveVideoRoom, Report, Notification, Lead, Author, AdminUser } from '../types';
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

// --- New Friend Request Syncing Logic ---
const syncAcceptedFriends = async (userId: string) => {
    if (!userId) return;
    // Find requests I sent that were accepted by the other user
    const q = db.collection('friendRequests')
        .where('from.id', '==', userId)
        .where('status', '==', 'accepted');
    
    const snapshot = await q.get();
    if (snapshot.empty) return;

    const batch = db.batch();
    const userRef = db.collection('users').doc(userId);
    const friendsToAdd = [];

    snapshot.docs.forEach(doc => {
        const request = doc.data();
        friendsToAdd.push(request.to.id);
        // Delete the request doc once it has been processed to complete the handshake
        batch.delete(doc.ref);
    });

    if (friendsToAdd.length > 0) {
        // Add the new friends to my own friends list
        batch.update(userRef, {
            friendIds: arrayUnion(...friendsToAdd),
            sentFriendRequests: arrayRemove(...friendsToAdd)
        });
        console.log(`Synced ${friendsToAdd.length} new friendships for user ${userId}.`);
        await batch.commit();
    }
};


// --- Service Definition ---
export const firebaseService = {
    // --- Authentication ---
    onAuthStateChanged: (callback: (user: User | null) => void) => {
        return auth.onAuthStateChanged(async (firebaseUser: FirebaseUser | null) => {
            if (firebaseUser) {
                try {
                    // Sync friendships on login before fetching profile
                    await syncAcceptedFriends(firebaseUser.uid);
                    
                    const userProfile = await firebaseService.getUserProfileById(firebaseUser.uid);
                    if (userProfile && !userProfile.isDeactivated && !userProfile.isBanned) {
                        callback(userProfile);
                    } else {
                        if(userProfile?.isDeactivated) console.log(`User ${firebaseUser.uid} is deactivated. Signing out.`);
                        if(userProfile?.isBanned) console.log(`User ${firebaseUser.uid} is banned. Signing out.`);
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
                    pendingFriendRequests: [], // Kept for potential backward compatibility or other features
                    sentFriendRequests: [],    // Kept for potential backward compatibility or other features
                    createdAt: serverTimestamp(),
                };
                
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
            try {
                const usernameDocRef = db.collection('usernames').doc(lowerIdentifier);
                const usernameDoc = await usernameDocRef.get();
                if (!usernameDoc.exists) throw new Error("Invalid details.");
                const userId = usernameDoc.data()!.userId;
                const userProfile = await this.getUserProfileById(userId);
                if (!userProfile) throw new Error("User profile not found.");
                emailToSignIn = userProfile.email;
            } catch (error: any) {
                throw new Error("Invalid details. Please check your username/email and password.");
            }
        }

        try {
            await auth.signInWithEmailAndPassword(emailToSignIn, pass);
        } catch (authError) {
            throw new Error("Invalid details. Please check your username/email and password.");
        }
    },
    
    signOutUser: () => auth.signOut(),

    // --- FIX START: Add missing notification methods ---
    // --- Notifications ---
    listenToNotifications(userId: string, callback: (notifications: Notification[]) => void) {
        const q = db.collection('users').doc(userId).collection('notifications').orderBy('createdAt', 'desc').limit(20);
        return q.onSnapshot((snapshot) => {
            const notifications = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
                } as Notification;
            });
            callback(notifications);
        });
    },

    async markNotificationsAsRead(userId: string, notificationIds: string[]): Promise<void> {
        if (notificationIds.length === 0) return;
        const batch = db.batch();
        const notificationsRef = db.collection('users').doc(userId).collection('notifications');
        notificationIds.forEach(id => {
            batch.update(notificationsRef.doc(id), { read: true });
        });
        await batch.commit();
    },
    // --- FIX END ---

    async isUsernameTaken(username: string): Promise<boolean> {
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
        if (userIds.length === 0) return [];
        const usersRef = db.collection('users');
        const userPromises: Promise<firebase.firestore.QuerySnapshot>[] = [];
        for (let i = 0; i < userIds.length; i += 10) {
            const chunk = userIds.slice(i, i + 10);
            userPromises.push(usersRef.where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get());
        }
        const userSnapshots = await Promise.all(userPromises);
        const users: User[] = [];
        userSnapshots.forEach(snapshot => {
            snapshot.docs.forEach(doc => users.push(docToUser(doc)));
        });
        return users;
    },

    // --- Friends (New Secure Implementation) ---
    async addFriend(currentUserId: string, targetUserId: string): Promise<{ success: boolean; reason?: string }> {
        const sender = await this.getUserProfileById(currentUserId);
        const receiver = await this.getUserProfileById(targetUserId);

        if (!sender || !receiver) return { success: false, reason: 'server_error' };
        
        // Prevent duplicate requests
        const requestId1 = `${currentUserId}_${targetUserId}`;
        const requestId2 = `${targetUserId}_${currentUserId}`;
        const existingReq1 = await db.collection('friendRequests').doc(requestId1).get();
        const existingReq2 = await db.collection('friendRequests').doc(requestId2).get();
        if (existingReq1.exists || existingReq2.exists) return { success: true }; // Already requested or friends

        // Privacy check
        if (receiver.privacySettings.friendRequestPrivacy === 'friends_of_friends') {
            const senderFriends = new Set(sender.friendIds || []);
            const receiverFriends = new Set(receiver.friendIds || []);
            const mutualFriends = [...senderFriends].filter(friendId => receiverFriends.has(friendId));
            if (mutualFriends.length === 0 && targetUserId !== currentUserId) {
                return { success: false, reason: 'friends_of_friends' };
            }
        }
        
        try {
            // Create a request document. This is secure.
            const requestDocRef = db.collection('friendRequests').doc(requestId1);
            await requestDocRef.set({
                from: { id: sender.id, name: sender.name, avatarUrl: sender.avatarUrl, username: sender.username },
                to: { id: receiver.id, name: receiver.name, avatarUrl: receiver.avatarUrl, username: receiver.username },
                status: 'pending',
                createdAt: serverTimestamp(),
            });

            // FIX: Removed the creation of a notification in the target user's subcollection.
            // This operation was causing a "Missing or insufficient permissions" error because
            // a user cannot write to another user's private data. In a real-world scenario,
            // this would be handled by a Cloud Function triggered by the creation of the
            // 'friendRequests' document. For this client-only app, the request is still
            // successfully created, and the recipient will see it in their "Friend Requests" tab.
    
            return { success: true };
        } catch (error) {
            console.error("Failed to send friend request:", error);
            return { success: false, reason: 'server_error' };
        }
    },

    async getFriendRequests(userId: string): Promise<User[]> {
        const q = db.collection('friendRequests')
            .where('to.id', '==', userId)
            .where('status', '==', 'pending');
        
        const snapshot = await q.get();
        if (snapshot.empty) return [];

        // Return the user object of the person who sent the request
        return snapshot.docs.map(doc => doc.data().from as User);
    },

    async acceptFriendRequest(currentUserId: string, requestingUserId: string): Promise<void> {
        const requestId = `${requestingUserId}_${currentUserId}`;
        const requestRef = db.collection('friendRequests').doc(requestId);
        const currentUserRef = db.collection('users').doc(currentUserId);
        
        try {
            // Update the request status to accepted. The sender's client will sync this later.
            await requestRef.update({ status: 'accepted' });
            
            // Current user immediately adds the friend.
            await currentUserRef.update({
                friendIds: arrayUnion(requestingUserId)
            });

            // Send notification back to the original sender
            const currentUserData = await this.getUserProfileById(currentUserId);
            if (!currentUserData) return;
            
            const notificationData = {
                type: 'friend_request_approved',
                user: { id: currentUserData.id, name: currentUserData.name, username: currentUserData.username, avatarUrl: currentUserData.avatarUrl },
                createdAt: serverTimestamp(),
                read: false,
            };
            await db.collection('users').doc(requestingUserId).collection('notifications').add(notificationData);
        } catch (error) {
            console.error("Error accepting friend request:", error);
        }
    },

    async declineFriendRequest(currentUserId: string, requestingUserId: string): Promise<void> {
        const requestId = `${requestingUserId}_${currentUserId}`;
        const requestRef = db.collection('friendRequests').doc(requestId);
        try {
            // Delete the request document entirely
            await requestRef.delete();
        } catch (error) {
            console.error("Error declining friend request:", error);
        }
    },

    listenToFriends(userId: string, callback: (friends: User[]) => void) {
        const userRef = db.collection('users').doc(userId);
        return userRef.onSnapshot(async (userDoc) => {
            if (userDoc.exists) {
                const friendIds = userDoc.data()!.friendIds || [];
                if (friendIds.length === 0) {
                    callback([]);
                    return;
                }
                const friends = await this.getUsersByIds(friendIds);
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

    // FIX: Add getExplorePosts for one-time fetch needed by Gemini
    async getExplorePosts(currentUserId: string): Promise<Post[]> {
        const q = db.collection('posts')
            .where('author.privacySettings.postVisibility', '==', 'public')
            .orderBy('createdAt', 'desc')
            .limit(50);
        const snapshot = await q.get();
        return snapshot.docs
            .map(docToPost)
            .filter(post => post.author.id !== currentUserId && !post.isSponsored);
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
// @FIXML-FIX: Add missing implementation for Rooms functionality
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
            callback(null);
        }
    });
},
async createLiveAudioRoom(host: User, topic: string): Promise<LiveAudioRoom> {
    const newRoomData = {
        host: { id: host.id, name: host.name, username: host.username, avatarUrl: host.avatarUrl },
        topic,
        speakers: [{ id: host.id, name: host.name, username: host.username, avatarUrl: host.avatarUrl }],
        listeners: [],
        raisedHands: [],
        createdAt: serverTimestamp(),
        status: 'live',
    };
    const docRef = await db.collection('liveAudioRooms').add(newRoomData);
    const doc = await docRef.get();
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt.toDate().toISOString(),
    } as LiveAudioRoom;
},
async createLiveVideoRoom(host: User, topic: string): Promise<LiveVideoRoom> {
    const newRoomData = {
        host: { id: host.id, name: host.name, username: host.username, avatarUrl: host.avatarUrl },
        topic,
        participants: [{ ...host, isMuted: false, isCameraOff: false }],
        createdAt: serverTimestamp(),
        status: 'live',
    };
    const docRef = await db.collection('liveVideoRooms').add(newRoomData);
    const doc = await docRef.get();
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt.toDate().toISOString(),
    } as LiveVideoRoom;
},
async joinLiveAudioRoom(userId: string, roomId: string): Promise<void> {
    const user = await this.getUserProfileById(userId);
    if (!user) return;
    const roomRef = db.collection('liveAudioRooms').doc(roomId);
    await roomRef.update({
        listeners: arrayUnion({ id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl }),
    });
},
async joinLiveVideoRoom(userId: string, roomId: string): Promise<void> {
    const user = await this.getUserProfileById(userId);
    if (!user) return;
    const roomRef = db.collection('liveVideoRooms').doc(roomId);
    await roomRef.update({
        participants: arrayUnion({ ...user, isMuted: false, isCameraOff: false }),
    });
},
async leaveLiveAudioRoom(userId: string, roomId: string): Promise<void> {
    const user = await this.getUserProfileById(userId);
    if (!user) return;
    const roomRef = db.collection('liveAudioRooms').doc(roomId);
    await roomRef.update({
        listeners: arrayRemove({ id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl }),
        speakers: arrayRemove({ id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl }),
        raisedHands: arrayRemove(userId)
    });
},
async leaveLiveVideoRoom(userId: string, roomId: string): Promise<void> {
    const user = await this.getUserProfileById(userId);
    if (!user) return;
    const roomRef = db.collection('liveVideoRooms').doc(roomId);
    // This is more complex in real-time, requires a transaction to prevent race conditions.
    const roomDoc = await roomRef.get();
    if(roomDoc.exists) {
        const participants = roomDoc.data().participants || [];
        const updatedParticipants = participants.filter(p => p.id !== userId);
        await roomRef.update({ participants: updatedParticipants });
    }
},
async endLiveAudioRoom(userId: string, roomId: string): Promise<void> {
    const roomRef = db.collection('liveAudioRooms').doc(roomId);
    const roomDoc = await roomRef.get();
    if (roomDoc.exists && roomDoc.data().host.id === userId) {
        await roomRef.update({ status: 'ended' });
    }
},
async endLiveVideoRoom(userId: string, roomId: string): Promise<void> {
    const roomRef = db.collection('liveVideoRooms').doc(roomId);
    const roomDoc = await roomRef.get();
    if (roomDoc.exists && roomDoc.data().host.id === userId) {
        await roomRef.update({ status: 'ended' });
    }
},
async getAudioRoomDetails(roomId: string): Promise<LiveAudioRoom | null> {
    const doc = await db.collection('liveAudioRooms').doc(roomId).get();
    if (doc.exists) {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt.toDate().toISOString()
        } as LiveAudioRoom;
    }
    return null;
},
async raiseHandInAudioRoom(userId: string, roomId: string): Promise<void> {
    await db.collection('liveAudioRooms').doc(roomId).update({ raisedHands: arrayUnion(userId) });
},
async inviteToSpeakInAudioRoom(hostId: string, userId: string, roomId: string): Promise<void> {
    const roomRef = db.collection('liveAudioRooms').doc(roomId);
    const roomDoc = await roomRef.get();
    if (roomDoc.exists && roomDoc.data().host.id === hostId) {
        const listener = roomDoc.data().listeners.find(l => l.id === userId);
        if (listener) {
            await roomRef.update({
                listeners: arrayRemove(listener),
                speakers: arrayUnion(listener),
                raisedHands: arrayRemove(userId),
            });
        }
    }
},
async moveToAudienceInAudioRoom(hostId: string, userId: string, roomId: string): Promise<void> {
    const roomRef = db.collection('liveAudioRooms').doc(roomId);
    const roomDoc = await roomRef.get();
    if (roomDoc.exists && roomDoc.data().host.id === hostId) {
        const speaker = roomDoc.data().speakers.find(s => s.id === userId);
        if (speaker && speaker.id !== hostId) {
            await roomRef.update({
                speakers: arrayRemove(speaker),
                listeners: arrayUnion(speaker),
            });
        }
    }
},

    // --- Campaigns, Stories, Groups, Admin, etc. ---
    async getCampaignsForSponsor(sponsorId: string): Promise<Campaign[]> {
        const q = db.collection('campaigns').where('sponsorId', '==', sponsorId).orderBy('createdAt', 'desc');
        const snapshot = await q.get();
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt instanceof firebase.firestore.Timestamp ? doc.data().createdAt.toDate().toISOString() : new Date().toISOString(),
        } as Campaign));
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
    async getStories(currentUserId: string): Promise<{ author: User; stories: Story[]; allViewed: boolean; }[]> {
        // This is a simplified mock as the full implementation is complex.
        const currentUser = await this.getUserProfileById(currentUserId);
        if (!currentUser) return [];
        return [];
    },
    async markStoryAsViewed(storyId: string, userId: string): Promise<void> {
        await db.collection('stories').doc(storyId).update({ viewedBy: arrayUnion(userId) });
    },
    async createStory(storyData: Omit<Story, 'id' | 'createdAt' | 'duration' | 'contentUrl' | 'viewedBy'>, mediaFile: File | null): Promise<Story> {
        const storyToSave: any = {
            ...storyData,
            author: { id: storyData.author.id, name: storyData.author.name, avatarUrl: storyData.author.avatarUrl, username: storyData.author.username },
            createdAt: serverTimestamp(),
            viewedBy: [],
        };
        let duration = 5;
        if (mediaFile) {
            const { url, type } = await uploadMediaToCloudinary(mediaFile, `story_${storyData.author.id}_${Date.now()}`);
            storyToSave.contentUrl = url;
            if (type === 'video') { duration = 15; }
        }
        storyToSave.duration = duration;
        const docRef = await db.collection('stories').add(storyToSave);
        return { id: docRef.id, ...storyData, createdAt: new Date().toISOString(), duration, contentUrl: storyToSave.contentUrl, viewedBy: [] };
    },
    async getGroupById(groupId: string): Promise<Group | null> {
        const doc = await db.collection('groups').doc(groupId).get();
        if (doc.exists) {
            const data = doc.data();
            return { id: doc.id, ...data } as Group;
        }
        return null;
    },
    async getSuggestedGroups(userId: string): Promise<Group[]> { return []; },
    async createGroup(creator, name, description, coverPhotoUrl, privacy, requiresApproval, category): Promise<Group> {
        const newGroupData = { creator, name, description, coverPhotoUrl, privacy, requiresApproval, category, members: [creator], memberCount: 1, admins: [creator], moderators: [], createdAt: serverTimestamp() };
        const docRef = await db.collection('groups').add(newGroupData);
        return { id: docRef.id, ...newGroupData, createdAt: new Date().toISOString() };
    },
    async joinGroup(userId, groupId, answers): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        const user = await this.getUserProfileById(userId);
        if (!user) return false;
        await groupRef.update({ members: arrayUnion(user), memberCount: increment(1) });
        return true;
    },
    async leaveGroup(userId, groupId): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        const user = await this.getUserProfileById(userId);
        if (!user) return false;
        await groupRef.update({ members: arrayRemove(user), memberCount: increment(-1) });
        return true;
    },
    async getPostsForGroup(groupId): Promise<Post[]> {
        const q = db.collection('posts').where('groupId', '==', groupId).where('status', '==', 'approved').orderBy('createdAt', 'desc');
        const snapshot = await q.get();
        return snapshot.docs.map(docToPost);
    },
    async updateGroupSettings(groupId, settings): Promise<boolean> {
        await db.collection('groups').doc(groupId).update(settings);
        return true;
    },
    async pinPost(groupId, postId): Promise<boolean> {
        await db.collection('groups').doc(groupId).update({ pinnedPostId: postId });
        return true;
    },
    async unpinPost(groupId): Promise<boolean> {
        await db.collection('groups').doc(groupId).update({ pinnedPostId: null });
        return true;
    },
    async inviteFriendToGroup(groupId, friendId): Promise<boolean> {
        await db.collection('groups').doc(groupId).update({ invitedUserIds: arrayUnion(friendId) });
        return true;
    },
    async getGroupChat(groupId): Promise<GroupChat | null> {
        const doc = await db.collection('groupChats').doc(groupId).get();
        return doc.exists ? { groupId, ...doc.data() } as GroupChat : null;
    },
    async sendGroupChatMessage(groupId, sender, text): Promise<any> {
        const message = { sender, text, createdAt: new Date().toISOString() };
        await db.collection('groupChats').doc(groupId).update({ messages: arrayUnion(message) });
        return message;
    },
    async getGroupEvents(groupId): Promise<any[]> { return []; },
    async createGroupEvent(creator, groupId, title, description, date): Promise<any> { return null; },
    async rsvpToEvent(userId, eventId): Promise<boolean> { return true; },
    async adminLogin(email, password): Promise<AdminUser | null> {
        const adminRef = db.collection('admins').doc(email);
        const doc = await adminRef.get();
        if (doc.exists && doc.data().password === password) { // NOTE: Insecure password check for demo only
            return { id: doc.id, email: doc.id };
        }
        return null;
    },
    async adminRegister(email, password): Promise<AdminUser | null> {
        const adminRef = db.collection('admins').doc(email);
        const doc = await adminRef.get();
        if (doc.exists) return null;
        await adminRef.set({ password });
        return { id: email, email };
    },
    async getAdminDashboardStats() { return { totalUsers: 0, newUsersToday: 0, postsLast24h: 0, pendingCampaigns: 0, activeUsersNow: 0, pendingReports: 0, pendingPayments: 0 }; },
    async getAllUsersForAdmin(): Promise<User[]> {
        const usersSnapshot = await db.collection('users').get();
        return usersSnapshot.docs.map(docToUser);
    },
    async updateUserRole(userId, newRole): Promise<boolean> {
        await db.collection('users').doc(userId).update({ role: newRole });
        return true;
    },
    async getPendingCampaigns(): Promise<Campaign[]> {
        const q = db.collection('campaigns').where('status', '==', 'pending');
        const snapshot = await q.get();
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Campaign));
    },
    async approveCampaign(campaignId): Promise<void> { await db.collection('campaigns').doc(campaignId).update({ status: 'active' }); },
    async rejectCampaign(campaignId, reason): Promise<void> { await db.collection('campaigns').doc(campaignId).update({ status: 'rejected' }); },
    async getAllPostsForAdmin(): Promise<Post[]> {
        const q = db.collection('posts').orderBy('createdAt', 'desc');
        const postQuery = await q.get();
        return postQuery.docs.map(docToPost);
    },
    async deletePostAsAdmin(postId): Promise<boolean> {
        await db.collection('posts').doc(postId).delete();
        return true;
    },
    async deleteCommentAsAdmin(commentId, postId): Promise<boolean> { return true; },
    async getPostById(postId): Promise<Post | null> {
        const doc = await db.collection('posts').doc(postId).get();
        return doc.exists ? docToPost(doc) : null;
    },
    async getPendingReports(): Promise<Report[]> { return []; },
    async resolveReport(reportId, resolution): Promise<void> { await db.collection('reports').doc(reportId).update({ status: 'resolved', resolution }); },
    async banUser(userId): Promise<boolean> {
        await db.collection('users').doc(userId).update({ isBanned: true });
        return true;
    },
    async unbanUser(userId): Promise<boolean> {
        await db.collection('users').doc(userId).update({ isBanned: false });
        return true;
    },
    async warnUser(userId, message): Promise<boolean> { return true; },
    async suspendUserCommenting(userId, days): Promise<boolean> { return true; },
    async liftUserCommentingSuspension(userId): Promise<boolean> { return true; },
    async suspendUserPosting(userId, days): Promise<boolean> { return true; },
    async liftUserPostingSuspension(userId): Promise<boolean> { return true; },
    async getUserDetailsForAdmin(userId): Promise<any> { return null; },
    async sendSiteWideAnnouncement(message): Promise<boolean> { return true; },
    async getAllCampaignsForAdmin(): Promise<Campaign[]> { return []; },
    async verifyCampaignPayment(campaignId, adminId): Promise<boolean> { return true; },
    async adminUpdateUserProfilePicture(userId: string, base64: string): Promise<User | null> {
        const userRef = db.collection('users').doc(userId);
        try {
            const blob = await fetch(base64).then(res => res.blob());
            const { url: newAvatarUrl } = await uploadMediaToCloudinary(blob, `avatar_${userId}_admin_${Date.now()}.jpeg`);
            await userRef.update({ avatarUrl: newAvatarUrl });
            const userDoc = await userRef.get();
            return userDoc.exists ? docToUser(userDoc) : null;
        } catch (error) {
            console.error("Error updating profile picture by admin:", error);
            return null;
        }
    },
    async reactivateUserAsAdmin(userId): Promise<boolean> {
        await db.collection('users').doc(userId).update({ isDeactivated: false });
        return true;
    },
    async promoteGroupMember(groupId: string, userToPromote: User, newRole: 'Admin' | 'Moderator'): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            const fieldToUpdate = newRole === 'Admin' ? 'admins' : 'moderators';
            const userObject = {
                id: userToPromote.id,
                name: userToPromote.name,
                username: userToPromote.username,
                avatarUrl: userToPromote.avatarUrl,
            };
            const otherField = newRole === 'Admin' ? 'moderators' : 'admins';
            await groupRef.update({
                [fieldToUpdate]: arrayUnion(userObject),
                [otherField]: arrayRemove(userObject),
            });
            return true;
        } catch (error) {
            console.error(`Failed to promote ${userToPromote.name} to ${newRole}:`, error);
            return false;
        }
    },
    async demoteGroupMember(groupId: string, userToDemote: User, oldRole: 'Admin' | 'Moderator'): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            const fieldToUpdate = oldRole === 'Admin' ? 'admins' : 'moderators';
            await groupRef.update({
                [fieldToUpdate]: arrayRemove({
                    id: userToDemote.id,
                    name: userToDemote.name,
                    username: userToDemote.username,
                    avatarUrl: userToDemote.avatarUrl,
                })
            });
            return true;
        } catch (error) {
            console.error(`Failed to demote ${userToDemote.name} from ${oldRole}:`, error);
            return false;
        }
    },
    async removeGroupMember(groupId: string, userToRemove: User): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            const userObject = {
                id: userToRemove.id,
                name: userToRemove.name,
                username: userToRemove.username,
                avatarUrl: userToRemove.avatarUrl,
            };
            await groupRef.update({
                members: arrayRemove(userObject),
                admins: arrayRemove(userObject),
                moderators: arrayRemove(userObject),
                memberCount: increment(-1),
            });
            return true;
        } catch (error) {
            console.error(`Failed to remove ${userToRemove.name} from group:`, error);
            return false;
        }
    },
    async approveJoinRequest(groupId: string, userId: string): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            await db.runTransaction(async (transaction) => {
                const groupDoc = await transaction.get(groupRef);
                if (!groupDoc.exists) throw "Group not found";
                
                const groupData = groupDoc.data() as Group;
                const joinRequests = groupData.joinRequests || [];
                const requestIndex = joinRequests.findIndex(r => r.user.id === userId);
                
                if (requestIndex === -1) return; // Request already handled
                
                const userToApprove = joinRequests[requestIndex].user;
                const updatedRequests = joinRequests.filter(r => r.user.id !== userId);
                
                const memberObject = {
                    id: userToApprove.id,
                    name: userToApprove.name,
                    username: userToApprove.username,
                    avatarUrl: userToApprove.avatarUrl,
                };

                transaction.update(groupRef, {
                    joinRequests: updatedRequests,
                    members: arrayUnion(memberObject),
                    memberCount: increment(1)
                });
            });
            return true;
        } catch (error) {
            console.error(`Failed to approve join request for user ${userId}:`, error);
            return false;
        }
    },
    async rejectJoinRequest(groupId: string, userId: string): Promise<boolean> {
        const groupRef = db.collection('groups').doc(groupId);
        try {
            await db.runTransaction(async (transaction) => {
                const groupDoc = await transaction.get(groupRef);
                if (!groupDoc.exists) throw "Group not found";

                const groupData = groupDoc.data() as Group;
                const updatedRequests = (groupData.joinRequests || []).filter(r => r.user.id !== userId);

                transaction.update(groupRef, { joinRequests: updatedRequests });
            });
            return true;
        } catch (error) {
            console.error(`Failed to reject join request for user ${userId}:`, error);
            return false;
        }
    },
    async approvePost(postId: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            await postRef.update({ status: 'approved' });
            const postDoc = await postRef.get();
            if (postDoc.exists && postDoc.data().groupId) {
                const groupId = postDoc.data().groupId;
                const groupRef = db.collection('groups').doc(groupId);
                const groupDoc = await groupRef.get();
                if (groupDoc.exists) {
                    const groupData = groupDoc.data() as Group;
                    const updatedPendingPosts = (groupData.pendingPosts || []).filter(p => p.id !== postId);
                    await groupRef.update({ pendingPosts: updatedPendingPosts });
                }
            }
            return true;
        } catch (error) {
            console.error(`Failed to approve post ${postId}:`, error);
            return false;
        }
    },
    async rejectPost(postId: string): Promise<boolean> {
        const postRef = db.collection('posts').doc(postId);
        try {
            const postDoc = await postRef.get();
            if (postDoc.exists && postDoc.data().groupId) {
                const groupId = postDoc.data().groupId;
                const groupRef = db.collection('groups').doc(groupId);
                const groupDoc = await groupRef.get();
                if (groupDoc.exists) {
                    const groupData = groupDoc.data() as Group;
                    const updatedPendingPosts = (groupData.pendingPosts || []).filter(p => p.id !== postId);
                    await groupRef.update({ pendingPosts: updatedPendingPosts });
                }
            }
            await postRef.delete();
            return true;
        } catch (error) {
            console.error(`Failed to reject/delete post ${postId}:`, error);
            return false;
        }
    },

    // --- FIX START: Add missing Ads & Monetization methods ---
    // --- Ads & Monetization ---
    async getInjectableAd(user: User): Promise<Post | null> {
        try {
            const q = db.collection('campaigns').where('status', '==', 'active').where('adType', '==', 'feed');
            const snapshot = await q.get();
            if (snapshot.empty) return null;
            
            const allCampaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
            const targetedCampaigns = allCampaigns.filter(c => matchesTargeting(c, user));

            if (targetedCampaigns.length === 0) return null;

            const adCampaign = targetedCampaigns[Math.floor(Math.random() * targetedCampaigns.length)];
            const sponsor = await this.getUserProfileById(adCampaign.sponsorId);
            if (!sponsor) return null;

            return {
                id: `ad_${adCampaign.id}`,
                author: { id: sponsor.id, name: sponsor.name, username: sponsor.username, avatarUrl: sponsor.avatarUrl },
                caption: adCampaign.caption,
                createdAt: new Date().toISOString(),
                commentCount: 0,
                comments: [],
                reactions: {},
                imageUrl: adCampaign.imageUrl,
                videoUrl: adCampaign.videoUrl,
                audioUrl: adCampaign.audioUrl,
                isSponsored: true,
                sponsorName: adCampaign.sponsorName,
                campaignId: adCampaign.id,
                websiteUrl: adCampaign.websiteUrl,
                allowDirectMessage: adCampaign.allowDirectMessage,
                allowLeadForm: adCampaign.allowLeadForm,
                sponsorId: adCampaign.sponsorId,
                duration: 0,
            } as Post;
        } catch (error) {
            console.error("Error getting injectable ad:", error);
            return null;
        }
    },

    async getInjectableStoryAd(user: User): Promise<Story | null> {
        try {
            const q = db.collection('campaigns').where('status', '==', 'active').where('adType', '==', 'story');
            const snapshot = await q.get();
            if (snapshot.empty) return null;

            const allCampaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
            const targetedCampaigns = allCampaigns.filter(c => matchesTargeting(c, user));

            if (targetedCampaigns.length === 0) return null;

            const adCampaign = targetedCampaigns[Math.floor(Math.random() * targetedCampaigns.length)];
            const sponsor = await this.getUserProfileById(adCampaign.sponsorId);
            if (!sponsor) return null;

            return {
                id: `ad_${adCampaign.id}`,
                author: { id: sponsor.id, name: sponsor.name, username: sponsor.username, avatarUrl: sponsor.avatarUrl },
                createdAt: new Date().toISOString(),
                type: adCampaign.videoUrl ? 'video' : 'image',
                contentUrl: adCampaign.videoUrl || adCampaign.imageUrl,
                duration: 15, // Story ads are typically short
                viewedBy: [],
                privacy: 'public',
                isSponsored: true,
                sponsorName: adCampaign.sponsorName,
                sponsorAvatar: sponsor.avatarUrl,
                campaignId: adCampaign.id,
                ctaLink: adCampaign.websiteUrl,
            } as Story;
        } catch (error) {
            console.error("Error getting injectable story ad:", error);
            return null;
        }
    },

    async trackAdView(campaignId: string): Promise<void> {
        if (!campaignId) return;
        const campaignRef = db.collection('campaigns').doc(campaignId);
        try {
            await campaignRef.update({
                views: increment(1)
            });
        } catch (error) {
            console.error("Error tracking ad view:", error);
        }
    },

    async trackAdClick(campaignId: string): Promise<void> {
        if (!campaignId) return;
        const campaignRef = db.collection('campaigns').doc(campaignId);
        try {
            await campaignRef.update({
                clicks: increment(1)
            });
        } catch (error) {
            console.error("Error tracking ad click:", error);
        }
    },

    async submitLead(leadData: Omit<Lead, 'id'>): Promise<void> {
        try {
            await db.collection('leads').add({
                ...leadData,
                createdAt: serverTimestamp() // Use server timestamp for accuracy
            });
        } catch (error) {
            console.error("Error submitting lead:", error);
            throw error;
        }
    },

    async getLeadsForCampaign(campaignId: string): Promise<Lead[]> {
        try {
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
        } catch (error) {
            console.error("Error fetching leads for campaign:", error);
            return [];
        }
    },
    // --- FIX END ---
    async getRandomActiveCampaign(): Promise<Campaign | null> {
        try {
            const q = db.collection('campaigns').where('status', '==', 'active');
            const snapshot = await q.get();
            if (snapshot.empty) {
                return null;
            }
            const campaigns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
            const randomIndex = Math.floor(Math.random() * campaigns.length);
            return campaigns[randomIndex];
        } catch (error) {
            console.error("Error getting random active campaign:", error);
            return null;
        }
    },
};