// @ts-nocheck
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { User as FirebaseUser } from 'firebase/auth';

import { db, auth, storage } from './firebaseConfig';
import { User, Post, Comment, Message, ReplyInfo, Story, Group, Campaign, LiveAudioRoom, LiveVideoRoom, Report, Notification, Lead, Author, AdminUser, FriendshipStatus, ChatSettings, Conversation, CategorizedExploreFeed, LiveVideoRoom, VideoParticipantState } from '../types';
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
    
    // Convert Firestore Timestamps to ISO strings for consistency
    if (user.createdAt && user.createdAt instanceof firebase.firestore.Timestamp) {
        user.createdAt = user.createdAt.toDate().toISOString();
    }
    if (user.commentingSuspendedUntil && user.commentingSuspendedUntil instanceof firebase.firestore.Timestamp) {
        user.commentingSuspendedUntil = user.commentingSuspendedUntil.toDate().toISOString();
    }
     if (user.postingSuspendedUntil && user.postingSuspendedUntil instanceof firebase.firestore.Timestamp) {
        user.postingSuspendedUntil = user.postingSuspendedUntil.toDate().toISOString();
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

const docToRoom = (doc: firebase.firestore.DocumentSnapshot): LiveAudioRoom | LiveVideoRoom => {
    const data = doc.data() || {};
    return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    } as LiveAudioRoom | LiveVideoRoom;
};

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

// --- Service Definition ---
export const firebaseService = {
    // --- Authentication ---
    onAuthStateChanged: (callback: (userAuth: { id: string } | null) => void) => {
        return auth.onAuthStateChanged((firebaseUser: FirebaseUser | null) => {
            if (firebaseUser) {
                callback({ id: firebaseUser.uid });
            } else {
                callback(null);
            }
        });
    },

    listenToCurrentUser(userId: string, callback: (user: User | null) => void) {
        const userRef = db.collection('users').doc(userId);
        return userRef.onSnapshot((doc) => {
            if (doc.exists) {
                callback(docToUser(doc));
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
    
     async getUserProfile(username: string): Promise<User | null> {
        const usersRef = db.collection('users');
        const q = usersRef.where('username', '==', username.toLowerCase());
        const querySnapshot = await q.get();

        if (querySnapshot.empty) {
            return null;
        }

        return docToUser(querySnapshot.docs[0]);
    },
    
    async getUserProfileById(uid: string): Promise<User | null> {
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        if (userDoc.exists) {
            return docToUser(userDoc);
        }
        return null;
    },
    
    async isUsernameTaken(username: string): Promise<boolean> {
        const usernameDocRef = db.collection('usernames').doc(username.toLowerCase());
        const usernameDoc = await usernameDocRef.get();
        return usernameDoc.exists;
    },
    
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

    // --- Friends ---
    listenToFriends(userId: string, callback: (friends: User[]) => void): () => void {
        let friendsData: { [key: string]: User } = {};
        let friendListeners: (() => void)[] = [];
        let mainUnsubscribe: (() => void) | null = null;
    
        const setupListeners = (friendIds: string[]) => {
          // Clean up old listeners
          friendListeners.forEach(unsubscribe => unsubscribe());
          friendListeners = [];
          friendsData = {};
    
          if (friendIds.length === 0) {
            callback([]);
            return;
          }
    
          friendIds.forEach((friendId: string) => {
            const friendUnsubscribe = db.collection('users').doc(friendId).onSnapshot(friendDoc => {
              if (friendDoc.exists) {
                friendsData[friendId] = docToUser(friendDoc);
                // On ANY update, send the full, fresh list of friends.
                // The spread operator is crucial here to create a new array reference,
                // which helps React detect the state change.
                callback(Object.values({ ...friendsData }));
              } else {
                // Friend was deleted or an error occurred
                delete friendsData[friendId];
                callback(Object.values({ ...friendsData }));
              }
            }, (error) => {
                console.error(`Error listening to friend ${friendId}:`, error);
            });
            friendListeners.push(friendUnsubscribe);
          });
        };
        
        mainUnsubscribe = db.collection('users').doc(userId).onSnapshot(userDoc => {
          if (!userDoc.exists) {
            callback([]);
            return;
          }
          const friendIds = userDoc.data()?.friendIds || [];
          setupListeners(friendIds);
        }, (error) => {
            console.error(`Error listening to current user ${userId}:`, error);
        });
    
        return () => {
          if (mainUnsubscribe) mainUnsubscribe();
          friendListeners.forEach(unsubscribe => unsubscribe());
        };
    },
    
    // --- Start of implemented functions ---
    getFriendRequests: async (userId: string) => {
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();
        if (!doc.exists) return [];
        const requestIds = doc.data()?.friendRequestsReceived || [];
        if (requestIds.length === 0) return [];
        return firebaseService.getUsersByIds(requestIds);
    },
    acceptFriendRequest: async (currentUserId: string, requestingUserId: string) => {
        const batch = db.batch();
        const currentUserRef = db.collection('users').doc(currentUserId);
        const requestingUserRef = db.collection('users').doc(requestingUserId);

        // Add each other to friends list
        batch.update(currentUserRef, { friendIds: arrayUnion(requestingUserId) });
        batch.update(requestingUserRef, { friendIds: arrayUnion(currentUserId) });

        // Remove request from current user's received list
        batch.update(currentUserRef, { friendRequestsReceived: arrayRemove(requestingUserId) });
        // Add a 'request approved' marker for the other user to listen to
        batch.update(requestingUserRef, { friendRequestsApproved: arrayUnion({ from: currentUserId, at: serverTimestamp() }) });
        
        await batch.commit();
    },
    declineFriendRequest: async (currentUserId: string, requestingUserId: string) => {
        const currentUserRef = db.collection('users').doc(currentUserId);
        await currentUserRef.update({ friendRequestsReceived: arrayRemove(requestingUserId) });
    },
    checkFriendshipStatus: async (currentUserId: string, profileUserId: string) => {
        const currentUserDoc = await db.collection('users').doc(currentUserId).get();
        const currentUserData = currentUserDoc.data();
        if (currentUserData?.friendIds?.includes(profileUserId)) {
            return FriendshipStatus.FRIENDS;
        }
        if (currentUserData?.friendRequestsSent?.includes(profileUserId)) {
            return FriendshipStatus.REQUEST_SENT;
        }
        if (currentUserData?.friendRequestsReceived?.includes(profileUserId)) {
            return FriendshipStatus.PENDING_APPROVAL;
        }
        return FriendshipStatus.NOT_FRIENDS;
    },
    addFriend: async (currentUserId: string, targetUserId: string) => {
        const targetUserRef = db.collection('users').doc(targetUserId);
        const batch = db.batch();
        
        // Add to my sent requests
        batch.update(db.collection('users').doc(currentUserId), { friendRequestsSent: arrayUnion(targetUserId) });
        // Add to their received requests
        batch.update(targetUserRef, { friendRequestsReceived: arrayUnion(currentUserId) });
        
        await batch.commit();
        return { success: true };
    },
    unfriendUser: async (currentUserId: string, targetUserId: string) => {
        const batch = db.batch();
        batch.update(db.collection('users').doc(currentUserId), { friendIds: arrayRemove(targetUserId) });
        batch.update(db.collection('users').doc(targetUserId), { friendIds: arrayRemove(currentUserId) });
        await batch.commit();
    },
    cancelFriendRequest: async (currentUserId: string, targetUserId: string) => {
        const batch = db.batch();
        batch.update(db.collection('users').doc(currentUserId), { friendRequestsSent: arrayRemove(targetUserId) });
        batch.update(db.collection('users').doc(targetUserId), { friendRequestsReceived: arrayRemove(currentUserId) });
        await batch.commit();
    },
    listenToAcceptedFriendRequests: (userId: string, callback) => {
        return db.collection('users').doc(userId).onSnapshot(doc => {
            const acceptedRequests = doc.data()?.friendRequestsApproved || [];
            if (acceptedRequests.length > 0) {
                callback(acceptedRequests);
            }
        });
    },
    finalizeFriendship: async (currentUserId: string, acceptedByUser: Author) => {
        const currentUserRef = db.collection('users').doc(currentUserId);
        // Remove from my sent list and remove the approval marker
        await currentUserRef.update({
            friendRequestsSent: arrayRemove(acceptedByUser.id),
            friendRequestsApproved: arrayRemove(acceptedByUser)
        });
    },
    listenToFeedPosts: (userId, callback) => {
        // A real feed algorithm is complex. This is a simplified version.
        const q = db.collection('posts').orderBy('createdAt', 'desc').limit(50);
        return q.onSnapshot(snapshot => {
            const posts = snapshot.docs.map(docToPost);
            callback(posts);
        });
    },
    listenToReelsPosts: (callback) => {
        const q = db.collection('posts').where('videoUrl', '!=', null).orderBy('videoUrl').orderBy('createdAt', 'desc').limit(20);
        return q.onSnapshot(snapshot => {
            callback(snapshot.docs.map(docToPost));
        });
    },
    listenToFriendRequests: (userId: string, callback: (requests: User[]) => void) => {
        return db.collection('users').doc(userId).onSnapshot(async (doc) => {
            const requestIds = doc.data()?.friendRequestsReceived || [];
            if (requestIds.length > 0) {
                const users = await firebaseService.getUsersByIds(requestIds);
                callback(users);
            } else {
                callback([]);
            }
        });
    },
    ensureChatDocumentExists: async (user1, user2) => {
        const chatId = [user1.id, user2.id].sort().join('_');
        const chatRef = db.collection('chats').doc(chatId);
        const doc = await chatRef.get();
        if (!doc.exists) {
            await chatRef.set({
                participants: [user1.id, user2.id],
                participantDetails: { [user1.id]: {name: user1.name, avatarUrl: user1.avatarUrl}, [user2.id]: {name: user2.name, avatarUrl: user2.avatarUrl}},
                createdAt: serverTimestamp(),
            });
        }
    },
    trackAdView: async (campaignId) => {
        await db.collection('campaigns').doc(campaignId).update({ views: increment(1) });
    },
    trackAdClick: async (campaignId) => {
        await db.collection('campaigns').doc(campaignId).update({ clicks: increment(1) });
    },
    submitLead: async (leadData) => {
        await db.collection('leads').add({
            ...leadData,
            createdAt: serverTimestamp()
        });
    },
    createComment: async (user, postId, commentData) => {
        const postRef = db.collection('posts').doc(postId);
        const newComment = {
            id: db.collection('posts').doc().id,
            author: { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl },
            postId,
            createdAt: new Date().toISOString(),
            ...commentData,
        };
        await postRef.update({
            comments: arrayUnion(newComment),
            commentCount: increment(1),
        });
        return newComment;
    },
    editComment: async (postId, commentId, newText) => {
       // Firestore does not support updating nested array elements directly.
       // This requires a read-modify-write transaction.
       const postRef = db.collection('posts').doc(postId);
       await db.runTransaction(async (transaction) => {
           const postDoc = await transaction.get(postRef);
           if (!postDoc.exists) throw "Post does not exist!";
           const postData = postDoc.data();
           const comments = postData.comments || [];
           const commentIndex = comments.findIndex(c => c.id === commentId);
           if (commentIndex > -1) {
               comments[commentIndex].text = newText;
               comments[commentIndex].updatedAt = new Date().toISOString();
               transaction.update(postRef, { comments });
           }
       });
    },
    deleteComment: async (postId, commentId) => {
       const postRef = db.collection('posts').doc(postId);
       await db.runTransaction(async (transaction) => {
           const postDoc = await transaction.get(postRef);
           if (!postDoc.exists) throw "Post does not exist!";
           const postData = postDoc.data();
           const comments = postData.comments || [];
           const updatedComments = comments.filter(c => c.id !== commentId);
           transaction.update(postRef, { comments: updatedComments, commentCount: increment(-1) });
       });
    },
    reactToPost: async (postId, userId, emoji) => {
        const postRef = db.collection('posts').doc(postId);
        // Using dot notation to update a map field.
        await postRef.update({
            [`reactions.${userId}`]: emoji
        });
        return true;
    },
    reactToComment: async (postId, commentId, userId, emoji) => {
       const postRef = db.collection('posts').doc(postId);
       await db.runTransaction(async (transaction) => {
           const postDoc = await transaction.get(postRef);
           if (!postDoc.exists) throw "Post does not exist!";
           const comments = postDoc.data().comments || [];
           const commentIndex = comments.findIndex(c => c.id === commentId);
           if (commentIndex > -1) {
               if (!comments[commentIndex].reactions) {
                   comments[commentIndex].reactions = {};
               }
               comments[commentIndex].reactions[userId] = emoji;
               transaction.update(postRef, { comments });
           }
       });
    },
    listenToPost: (postId, callback) => {
        return db.collection('posts').doc(postId).onSnapshot(doc => {
            if (doc.exists) {
                callback(docToPost(doc));
            } else {
                callback(null);
            }
        });
    },
    createPost: async (postData, media) => {
        let mediaUrl = null;
        let finalPostData = { ...postData, createdAt: serverTimestamp() };

        if (media.mediaFile) {
            const { url } = await uploadMediaToCloudinary(media.mediaFile, `posts/${Date.now()}_${media.mediaFile.name}`);
            mediaUrl = url;
            if (media.mediaFile.type.startsWith('video')) {
                finalPostData.videoUrl = mediaUrl;
            } else {
                finalPostData.imageUrl = mediaUrl;
            }
        } else if (media.audioBlobUrl) {
            const blob = await fetch(media.audioBlobUrl).then(r => r.blob());
            const { url } = await uploadMediaToCloudinary(blob, `posts/${Date.now()}.webm`);
            finalPostData.audioUrl = url;
        } else if (media.generatedImageBase64) {
            const blob = await fetch(media.generatedImageBase64).then(r => r.blob());
             const { url } = await uploadMediaToCloudinary(blob, `posts/${Date.now()}_ai.jpeg`);
            finalPostData.imageUrl = url;
        }
        
        await db.collection('posts').add(finalPostData);
    },
    getLeadsForCampaign: async (campaignId) => {
        const snapshot = await db.collection('leads').where('campaignId', '==', campaignId).orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead));
    },
    getInjectableAd: async (user) => {
        // Mock function
        return null;
    },
    getInjectableStoryAd: async (user) => {
        // Mock function
        return null;
    },
    updateProfile: async (userId, updates) => {
        await db.collection('users').doc(userId).update(updates);
    },
    updateProfilePicture: async (userId, base64, caption, captionStyle) => {
        const { url } = await uploadMediaToCloudinary(await (await fetch(base64)).blob(), `avatars/${userId}.jpeg`);
        await db.collection('users').doc(userId).update({ avatarUrl: url });
        
        const user = await firebaseService.getUserProfileById(userId);
        if(!user) return null;

        const newPost = {
            author: { id: user.id, name: user.name, username: user.username, avatarUrl: url },
            caption: caption || `${user.name} updated their profile picture.`,
            captionStyle,
            createdAt: serverTimestamp(),
            postType: 'profile_picture_change',
            newPhotoUrl: url,
            comments: [],
            reactions: {},
            commentCount: 0,
        };
        
        const postRef = await db.collection('posts').add(newPost);
        
        return {
            updatedUser: { ...user, avatarUrl: url },
            newPost: { ...newPost, id: postRef.id, createdAt: new Date().toISOString() },
        };
    },
    updateCoverPhoto: async (userId, base64, caption, captionStyle) => {
        const { url } = await uploadMediaToCloudinary(await (await fetch(base64)).blob(), `covers/${userId}.jpeg`);
        await db.collection('users').doc(userId).update({ coverPhotoUrl: url });

        const user = await firebaseService.getUserProfileById(userId);
        if(!user) return null;
        
        const newPost = {
            author: { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl },
            caption: caption || `${user.name} updated their cover photo.`,
            captionStyle,
            createdAt: serverTimestamp(),
            postType: 'cover_photo_change',
            newPhotoUrl: url,
            comments: [],
            reactions: {},
            commentCount: 0,
        };
        
        const postRef = await db.collection('posts').add(newPost);
        
        return {
            updatedUser: { ...user, coverPhotoUrl: url },
            newPost: { ...newPost, id: postRef.id, createdAt: new Date().toISOString() },
        };
    },
    blockUser: async (currentUserId, targetUserId) => {
        await db.collection('users').doc(currentUserId).update({ blockedUserIds: arrayUnion(targetUserId) });
        return true;
    },
    unblockUser: async (currentUserId, targetUserId) => {
        await db.collection('users').doc(currentUserId).update({ blockedUserIds: arrayRemove(targetUserId) });
        return true;
    },
    deactivateAccount: async (userId) => {
        await db.collection('users').doc(userId).update({ isDeactivated: true });
        return true;
    },
    updateVoiceCoins: async (userId, amount) => {
        await db.collection('users').doc(userId).update({ voiceCoins: increment(amount) });
        return true;
    },
    getChatId: (user1Id, user2Id) => [user1Id, user2Id].sort().join('_'),
    listenToMessages: (chatId, callback) => {
        return db.collection('chats').doc(chatId).collection('messages').orderBy('createdAt', 'asc')
            .onSnapshot(snapshot => {
                const messages = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    createdAt: doc.data().createdAt?.toDate().toISOString(),
                } as Message));
                callback(messages);
            });
    },
    listenToConversations: (userId, callback) => {
       return db.collection('chats').where('participants', 'array-contains', userId)
        .onSnapshot(async (snapshot) => {
            const convos: Conversation[] = [];
            for (const doc of snapshot.docs) {
                const data = doc.data();
                const peerId = data.participants.find(p => p !== userId);
                if (peerId) {
                    const peer = await firebaseService.getUserProfileById(peerId);
                    if (peer) {
                        const lastMessageSnapshot = await db.collection('chats').doc(doc.id).collection('messages').orderBy('createdAt', 'desc').limit(1).get();
                        const unreadSnapshot = await db.collection('chats').doc(doc.id).collection('messages').where('recipientId', '==', userId).where('read', '==', false).get();
                        
                        if (!lastMessageSnapshot.empty) {
                             const lastMessageData = lastMessageSnapshot.docs[0].data();
                             convos.push({
                                peer,
                                lastMessage: {
                                    ...lastMessageData,
                                    id: lastMessageSnapshot.docs[0].id,
                                    createdAt: lastMessageData.createdAt?.toDate().toISOString(),
                                } as Message,
                                unreadCount: unreadSnapshot.size,
                             });
                        }
                    }
                }
            }
            callback(convos.sort((a,b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()));
        });
    },
    sendMessage: async (chatId, sender, recipient, messageContent) => {
        let content: Partial<Message> = {
            senderId: sender.id,
            recipientId: recipient.id,
            createdAt: serverTimestamp(),
            read: false,
        };
        
        if (messageContent.mediaFile) {
            const { url } = await uploadMediaToCloudinary(messageContent.mediaFile, `chats/${chatId}/${Date.now()}`);
            content.mediaUrl = url;
        } else if (messageContent.audioBlob) {
            const { url } = await uploadMediaToCloudinary(messageContent.audioBlob, `chats/${chatId}/${Date.now()}.webm`);
            content.audioUrl = url;
            content.duration = messageContent.duration;
        }

        content.type = messageContent.type;
        content.text = messageContent.text;
        content.replyTo = messageContent.replyTo;

        await db.collection('chats').doc(chatId).collection('messages').add(content);
        await db.collection('chats').doc(chatId).update({ lastActivity: serverTimestamp() });
    },
    unsendMessage: async (chatId, messageId, userId) => {
        const messageRef = db.collection('chats').doc(chatId).collection('messages').doc(messageId);
        // Add a check to ensure user can only delete their own message
        const doc = await messageRef.get();
        if (doc.exists && doc.data()?.senderId === userId) {
            await messageRef.update({ text: '', mediaUrl: '', audioUrl: '', isDeleted: true });
        }
    },
    reactToMessage: async (chatId, messageId, userId, emoji) => {
        const messageRef = db.collection('chats').doc(chatId).collection('messages').doc(messageId);
        await messageRef.update({
            [`reactions.${emoji}`]: arrayUnion(userId) // This structure allows multiple reactions
        });
    },
    deleteChatHistory: async (chatId) => {
        // This is a destructive operation. In a real app, you might soft delete.
        const messages = await db.collection('chats').doc(chatId).collection('messages').get();
        const batch = db.batch();
        messages.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await db.collection('chats').doc(chatId).delete();
    },
    getChatSettings: async (chatId) => {
        const doc = await db.collection('chats').doc(chatId).get();
        return (doc.data()?.settings || { theme: 'default' }) as ChatSettings;
    },
    updateChatSettings: async (chatId, settings) => {
        await db.collection('chats').doc(chatId).update({ settings });
    },
    markMessagesAsRead: async (chatId, userId) => {
        const unreadMessages = await db.collection('chats').doc(chatId).collection('messages').where('recipientId', '==', userId).where('read', '==', false).get();
        const batch = db.batch();
        unreadMessages.docs.forEach(doc => {
            batch.update(doc.ref, { read: true });
        });
        await batch.commit();
    },
    getCommonFriends: async (userId1, userId2) => [], // Mock
    getUsersByIds: async (uids) => {
        if (!uids || uids.length === 0) return [];
        const userRefs = uids.map(id => db.collection('users').doc(id));
        const userDocs = await Promise.all(userRefs.map(ref => ref.get()));
        return userDocs.filter(doc => doc.exists).map(doc => docToUser(doc));
    },
    getPostsByUser: async (userId) => {
        const snapshot = await db.collection('posts').where('author.id', '==', userId).orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(docToPost);
    },
    listenToUserProfile: (username, callback) => {
        const q = db.collection('users').where('username', '==', username);
        return q.onSnapshot(snapshot => {
            if (!snapshot.empty) {
                callback(docToUser(snapshot.docs[0]));
            } else {
                callback(null);
            }
        });
    },
    // Rooms
    listenToLiveAudioRooms: (callback) => db.collection('audioRooms').where('status', '==', 'live').onSnapshot(snap => callback(snap.docs.map(docToRoom))),
    listenToLiveVideoRooms: (callback) => db.collection('videoRooms').where('status', '==', 'live').onSnapshot(snap => callback(snap.docs.map(docToRoom))),
    listenToRoom: (roomId, type, callback) => db.collection(type === 'audio' ? 'audioRooms' : 'videoRooms').doc(roomId).onSnapshot(doc => callback(doc.exists ? docToRoom(doc) : null)),
    createLiveAudioRoom: async (host, topic) => {
        const newRoomRef = db.collection('audioRooms').doc();
        const newRoom = { id: newRoomRef.id, host, topic, speakers: [host], listeners: [], raisedHands: [], createdAt: serverTimestamp(), status: 'live' };
        await newRoomRef.set(newRoom);
        return newRoom;
    },
    createLiveVideoRoom: async (host, topic) => {
        const newRoomRef = db.collection('videoRooms').doc();
        const newRoom = { id: newRoomRef.id, host, topic, participants: [host], createdAt: serverTimestamp(), status: 'live' };
        await newRoomRef.set(newRoom);
        return newRoom;
    },
    joinLiveAudioRoom: (userId, roomId) => db.collection('audioRooms').doc(roomId).update({ listeners: arrayUnion(userId) }),
    joinLiveVideoRoom: (userId, roomId) => db.collection('videoRooms').doc(roomId).update({ participants: arrayUnion(userId) }),
    leaveLiveAudioRoom: (userId, roomId) => db.collection('audioRooms').doc(roomId).update({ listeners: arrayRemove(userId), speakers: arrayRemove(userId) }),
    leaveLiveVideoRoom: (userId, roomId) => db.collection('videoRooms').doc(roomId).update({ participants: arrayRemove(userId) }),
    endLiveAudioRoom: (userId, roomId) => db.collection('audioRooms').doc(roomId).update({ status: 'ended' }), // Add host check server-side
    endLiveVideoRoom: (userId, roomId) => db.collection('videoRooms').doc(roomId).update({ status: 'ended' }), // Add host check server-side
    getAudioRoomDetails: async (roomId) => {
        const doc = await db.collection('audioRooms').doc(roomId).get();
        return doc.exists ? docToRoom(doc) : null;
    },
    raiseHandInAudioRoom: (userId, roomId) => db.collection('audioRooms').doc(roomId).update({ raisedHands: arrayUnion(userId) }),
    inviteToSpeakInAudioRoom: (hostId, userId, roomId) => db.collection('audioRooms').doc(roomId).update({ raisedHands: arrayRemove(userId), speakers: arrayUnion(userId), listeners: arrayRemove(userId) }),
    moveToAudienceInAudioRoom: (hostId, userId, roomId) => db.collection('audioRooms').doc(roomId).update({ speakers: arrayRemove(userId), listeners: arrayUnion(userId) }),

    // Campaigns & Ads
    getCampaignsForSponsor: async (sponsorId) => {
        const snapshot = await db.collection('campaigns').where('sponsorId', '==', sponsorId).orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign));
    },
    submitCampaignForApproval: async (campaignData, transactionId) => {
        await db.collection('campaigns').add({ ...campaignData, transactionId, status: 'pending' });
    },
    getRandomActiveCampaign: async () => {
        // This is a simplified version. A real implementation might need more complex logic for randomness at scale.
        const snapshot = await db.collection('campaigns').where('status', '==', 'active').limit(10).get();
        if (snapshot.empty) return null;
        const randomIndex = Math.floor(Math.random() * snapshot.docs.length);
        return { id: snapshot.docs[randomIndex].id, ...snapshot.docs[randomIndex].data() } as Campaign;
    },

    // Stories
    getStories: async (currentUserId) => {
      // Mock implementation, will be complex in real app
      return [];
    },
    markStoryAsViewed: (storyId, userId) => db.collection('stories').doc(storyId).update({ viewedBy: arrayUnion(userId) }),
    createStory: async (storyData, mediaFile) => {
        let contentUrl;
        if (mediaFile) {
            const { url } = await uploadMediaToCloudinary(mediaFile, `stories/${currentUser.id}/${Date.now()}`);
            contentUrl = url;
        }
        const newStoryRef = db.collection('stories').doc();
        const newStory = { ...storyData, id: newStoryRef.id, contentUrl, createdAt: serverTimestamp(), duration: 15, viewedBy: [] };
        await newStoryRef.set(newStory);
        return newStory;
    },
    
    // Groups
    getGroupById: async (groupId) => {
        const doc = await db.collection('groups').doc(groupId).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },
    getSuggestedGroups: async (userId) => {
      // Mock
      return [];
    },
    createGroup: async (creator, name, description, coverPhotoUrl, privacy, requiresApproval, category) => {
        const newGroupRef = db.collection('groups').doc();
        const newGroup = { id: newGroupRef.id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), description, coverPhotoUrl, privacy, requiresApproval, category, creator, members: [creator], admins: [creator], memberCount: 1, createdAt: serverTimestamp() };
        await newGroupRef.set(newGroup);
        return newGroup;
    },
    joinGroup: async (userId, groupId, answers) => {
        await db.collection('groups').doc(groupId).update({ joinRequests: arrayUnion({ userId, answers, requestedAt: serverTimestamp() }) });
        return true;
    },
    leaveGroup: async (userId, groupId) => {
        await db.collection('groups').doc(groupId).update({ members: arrayRemove(userId), memberCount: increment(-1) });
        return true;
    },
    getPostsForGroup: async (groupId) => {
        const snapshot = await db.collection('posts').where('groupId', '==', groupId).where('status', '==', 'approved').orderBy('createdAt', 'desc').get();
        return snapshot.docs.map(docToPost);
    },
    updateGroupSettings: async (groupId, settings) => { await db.collection('groups').doc(groupId).update(settings); return true; },
    pinPost: (groupId, postId) => db.collection('groups').doc(groupId).update({ pinnedPostId: postId }),
    unpinPost: (groupId) => db.collection('groups').doc(groupId).update({ pinnedPostId: firebase.firestore.FieldValue.delete() }),
    voteOnPoll: async (userId, postId, optionIndex) => {
        const postRef = db.collection('posts').doc(postId);
        // Transaction needed
        return null;
    },
    markBestAnswer: async (userId, postId, commentId) => {
         await db.collection('posts').doc(postId).update({ bestAnswerId: commentId });
         // Simplified, would need permission checks
         return await firebaseService.getPostById(postId);
    },
    inviteFriendToGroup: (groupId, friendId) => db.collection('groups').doc(groupId).update({ invitedUserIds: arrayUnion(friendId) }),
    
    // Group Chat & Events
    getGroupChat: async (groupId) => null,
    sendGroupChatMessage: async (groupId, sender, text) => ({ id: '', sender, text, createdAt: new Date().toISOString() }),
    getGroupEvents: async (groupId) => [],
    createGroupEvent: async (creator, groupId, title, description, date) => null,
    rsvpToEvent: async (userId, eventId) => true,
    
    // Admin
    adminLogin: async (email, password) => null,
    adminRegister: async (email, password) => null,
    getAdminDashboardStats: async () => ({ totalUsers: 0, newUsersToday: 0, postsLast24h: 0, pendingCampaigns: 0, activeUsersNow: 0, pendingReports: 0, pendingPayments: 0 }),
    getAllUsersForAdmin: async () => {
        const snapshot = await db.collection('users').get();
        return snapshot.docs.map(docToUser);
    },
    updateUserRole: async (userId, newRole) => true,
    getPendingCampaigns: async () => [],
    approveCampaign: async (campaignId) => {},
    rejectCampaign: async (campaignId, reason) => {},
    getAllPostsForAdmin: async () => [],
    deletePostAsAdmin: async (postId) => true,
    deleteCommentAsAdmin: async (commentId, postId) => true,
    getPostById: async (postId) => {
        const doc = await db.collection('posts').doc(postId).get();
        return doc.exists ? docToPost(doc) : null;
    },
    getPendingReports: async () => [],
    resolveReport: async (reportId, resolution) => {},
    banUser: async (userId) => true,
    unbanUser: async (userId) => true,
    warnUser: async (userId, message) => true,
    suspendUserCommenting: async (userId, days) => true,
    liftUserCommentingSuspension: async (userId) => true,
    suspendUserPosting: async (userId, days) => true,
    liftUserPostingSuspension: async (userId) => true,
    getUserDetailsForAdmin: async (userId) => ({ user: null, posts: [], comments: [], reports: [] }),
    sendSiteWideAnnouncement: async (message) => true,
    getAllCampaignsForAdmin: async () => [],
    verifyCampaignPayment: async (campaignId, adminId) => true,
    adminUpdateUserProfilePicture: async (userId, base64) => null,
    reactivateUserAsAdmin: async (userId) => true,
    promoteGroupMember: async (groupId, userToPromote, newRole) => true,
    demoteGroupMember: async (groupId, userToDemote, oldRole) => true,
    removeGroupMember: async (groupId, userToRemove) => true,
    approveJoinRequest: async (groupId, userId) => true,
    rejectJoinRequest: async (groupId, userId) => true,
    approvePost: async (postId) => true,
    rejectPost: async (postId) => true,
    getExplorePosts: async (userId) => {
        const snapshot = await db.collection('posts').where('privacySettings.postVisibility', '==', 'public').orderBy('createdAt', 'desc').limit(20).get();
        return snapshot.docs.map(docToPost);
    }
};
