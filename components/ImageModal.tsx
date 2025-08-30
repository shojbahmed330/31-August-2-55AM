
import React, { useEffect, useState } from 'react';
import { Post, User, Comment } from '../types';
import Icon from './Icon';
import CommentCard from './CommentCard';
import TaggedContent from './TaggedContent';
import { PostCard } from './PostCard'; // For action buttons logic

interface ImageModalProps {
  post: Post | null;
  isLoading: boolean;
  currentUser: User;
  onClose: () => void;
  onReactToPost: (postId: string, emoji: string) => void;
  onStartComment: (postId: string) => void;
  onOpenProfile: (userName: string) => void;
  onSharePost: (post: Post) => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ post, isLoading, currentUser, onClose, onReactToPost, onStartComment, onOpenProfile, onSharePost }) => {
  const [playingCommentId, setPlayingCommentId] = useState<string | null>(null);

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
  
  const handlePlayComment = (comment: Comment) => {
    if (comment.type !== 'audio') return;
    setPlayingCommentId(prev => prev === comment.id ? null : comment.id);
  };
  
  if (isLoading) {
    return (
       <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <Icon name="logo" className="w-16 h-16 text-lime-500 animate-spin"/>
       </div>
    );
  }
  
  if (!post) return null;

  const imageUrl = post.imageUrl || post.newPhotoUrl;
  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-stretch"
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 p-2 rounded-full text-white bg-black/30 hover:bg-black/60 transition-colors z-20"
        aria-label="Close image viewer"
      >
        <Icon name="close" className="w-8 h-8" />
      </button>
      
      <main className="flex-grow flex items-center justify-center p-4 md:p-8" onClick={(e) => e.stopPropagation()}>
          <img
            src={imageUrl}
            alt="Full screen view"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
      </main>

      <aside className="w-[380px] flex-shrink-0 bg-slate-900 border-l border-slate-700/50 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <header className="p-4 border-b border-slate-700">
              <button onClick={() => onOpenProfile(post.author.username)} className="flex items-center gap-3 group">
                <img src={post.author.avatarUrl} alt={post.author.name} className="w-12 h-12 rounded-full" />
                <div>
                  <p className="font-bold text-lg text-lime-300 group-hover:underline">{post.author.name}</p>
                  <p className="text-sm text-slate-400">{new Date(post.createdAt).toLocaleString()}</p>
                </div>
              </button>
              {post.caption && (
                <p className="text-slate-200 mt-3"><TaggedContent text={post.caption} onTagClick={onOpenProfile} /></p>
              )}
          </header>

          <div className="flex-grow overflow-y-auto p-4 space-y-3">
            {post.comments.length > 0 ? (
                post.comments.map(comment => (
                    <CommentCard 
                        key={comment.id}
                        comment={comment}
                        isPlaying={playingCommentId === comment.id}
                        onPlayPause={() => handlePlayComment(comment)}
                        onAuthorClick={onOpenProfile}
                    />
                ))
            ) : (
                <p className="text-center text-slate-500 pt-8">No comments yet.</p>
            )}
          </div>
          
          <footer className="p-2 border-t border-slate-700">
            {/* We can re-use the action buttons from PostCard by passing a minimal version of it */}
            <PostCard 
              post={post}
              currentUser={currentUser}
              onReact={onReactToPost}
              onStartComment={onStartComment}
              onSharePost={onSharePost}
              // Dummy props to satisfy the interface
              isActive={true}
              isPlaying={false}
              onPlayPause={()=>{}}
              onViewPost={()=>{}}
              onAuthorClick={()=>{}}
            />
          </footer>
      </aside>
    </div>
  );
};

export default ImageModal;
