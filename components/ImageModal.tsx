import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Post, User, Comment } from '../types';
import Icon from './Icon';
import CommentCard from './CommentCard';
import TaggedContent from './TaggedContent';
import ReactionListModal from './ReactionListModal';

interface ImageModalProps {
  post: Post | null;
  currentUser: User;
  isLoading: boolean;
  onClose: () => void;
  onReactToPost: (postId: string, emoji: string) => void;
  onReactToComment: (postId: string, commentId: string, emoji: string) => void;
  onPostComment: (postId: string, text: string, parentId?: string | null) => Promise<void>;
  onEditComment: (postId: string, commentId: string, newText: string) => Promise<void>;
  onDeleteComment: (postId: string, commentId: string) => Promise<void>;
  onOpenProfile: (userName: string) => void;
  onSharePost: (post: Post) => void;
}

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

const ImageModal: React.FC<ImageModalProps> = ({ post, currentUser, isLoading, onClose, onReactToPost, onReactToComment, onPostComment, onEditComment, onDeleteComment, onOpenProfile, onSharePost }) => {
  // FINAL FIX: This is the most robust way to prevent the crash.
  // If the post data is null, OR if the author field is missing (e.g. user was deleted),
  // we render nothing. This completely avoids any attempt to access properties of a null object.
  if (!post || !post.author) {
    onClose(); // Close the modal if the data is invalid
    return null;
  }
  
  const [playingCommentId, setPlayingCommentId] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [isReactionModalOpen, setIsReactionModalOpen] = useState(false);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const pickerTimeout = useRef<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [onClose]);

  useEffect(() => {
    if (replyingTo) {
        commentInputRef.current?.focus();
    }
  }, [replyingTo]);
  
  const commentThreads = useMemo(() => {
    if (!post.comments) return [];
    
    const comments = [...post.comments].filter(Boolean).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const commentsById = new Map<string, Comment & { replies: Comment[] }>();
    comments.forEach(c => commentsById.set(c.id, { ...c, replies: [] }));

    const topLevelComments: (Comment & { replies: Comment[] })[] = [];
    
    comments.forEach(c => {
        const commentWithReplies = commentsById.get(c.id);
        if (!commentWithReplies) return;

        if (c.parentId && commentsById.has(c.parentId)) {
            commentsById.get(c.parentId)?.replies.push(commentWithReplies);
        } else {
            topLevelComments.push(commentWithReplies);
        }
    });

    return topLevelComments;
  }, [post.comments]);

  const handlePlayComment = (comment: Comment) => {
    if (comment.type !== 'audio') return;
    setPlayingCommentId(prev => prev === comment.id ? null : comment.id);
  };
  
  const handlePostCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !newCommentText.trim() || isPostingComment) return;
    setIsPostingComment(true);
    try {
        await onPostComment(post.id, newCommentText, replyingTo?.id || null);
        setNewCommentText('');
        setReplyingTo(null);
    } catch (error) {
        console.error("Failed to post comment:", error);
    } finally {
        setIsPostingComment(false);
    }
  };
  
  const handleMouseEnterPicker = () => {
    if (pickerTimeout.current) clearTimeout(pickerTimeout.current);
    setPickerOpen(true);
  };

  const handleMouseLeavePicker = () => {
    pickerTimeout.current = window.setTimeout(() => {
        setPickerOpen(false);
    }, 300);
  };

  const handleReaction = (e: React.MouseEvent, emoji: string) => {
      e.stopPropagation();
      if (post) onReactToPost(post.id, emoji);
      setPickerOpen(false);
  };

  const myReaction = useMemo(() => {
    if (!currentUser || !post.reactions) return null;
    return post.reactions[currentUser.id] || null;
  }, [currentUser, post.reactions]);

  const reactionCount = useMemo(() => {
    if (!post.reactions) return 0;
    return Object.keys(post.reactions).length;
  }, [post.reactions]);

  const topReactions = useMemo(() => {
    if (!post.reactions) return [];
    const counts: { [key: string]: number } = {};
    Object.values(post.reactions).forEach(emoji => {
        counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  }, [post.reactions]);

  if (isLoading) {
    return (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center">
            <Icon name="logo" className="w-16 h-16 text-lime-500 animate-spin" />
        </div>
    );
  }
  
  const imageUrl = post.imageUrl || post.newPhotoUrl;
  if (!imageUrl) {
    onClose();
    return null;
  }

  return (
    <>
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-stretch"
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 p-2 rounded-full text-white bg-black/30 hover:bg-black/60 transition-colors z-[51]"
        aria-label="Close image viewer"
      >
        <Icon name="close" className="w-8 h-8" />
      </button>
      
      <main className="flex-grow flex items-center justify-center p-4 md:p-8 relative" onClick={(e) => e.stopPropagation()}>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                <Icon name="logo" className="w-16 h-16 text-lime-500 animate-spin"/>
            </div>
          )}
          <img
            src={imageUrl}
            alt="Full screen view"
            className={`max-w-full max-h-full object-contain rounded-lg transition-opacity ${isLoading ? 'opacity-50' : 'opacity-100'}`}
          />
      </main>

      <aside className={`w-[380px] flex-shrink-0 bg-slate-900 border-l border-slate-700/50 flex flex-col transition-opacity ${isLoading ? 'opacity-50' : 'opacity-100'}`} onClick={(e) => e.stopPropagation()}>
          <header className="p-4 border-b border-slate-700">
              <button onClick={() => onOpenProfile(post.author.username)} className="flex items-center gap-3 group">
                <img src={post.author.avatarUrl} alt={post.author.name} className="w-12 h-12 rounded-full" />
                <div>
                  <p className="font-bold text-lg text-lime-300 group-hover:underline">{post.author.name}</p>
                  <p className="text-sm text-slate-400">{new Date(post.createdAt).toLocaleString()}</p>
                </div>
              </button>
              {post.caption && (
                <p className