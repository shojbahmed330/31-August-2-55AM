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
        createdAt: data.createdAt instanceof firebase.firestore.Timestamp ?