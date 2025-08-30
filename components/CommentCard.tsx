
import React, { useRef, useEffect } from 'react';
import type { Comment } from '../types';
import Icon from './Icon';
import Waveform from './Waveform';
import TaggedContent from './TaggedContent';

interface CommentCardProps {
  comment: Comment;
  isPlaying: boolean;
  onPlayPause: () => void;
  onAuthorClick: (username: string) => void;
}

const CommentCard: React.FC<CommentCardProps> = ({ comment, isPlaying, onPlayPause, onAuthorClick }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeAgo = new Date(comment.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
        if (isPlaying) {
            audioElement.play().catch(e => console.error("Comment audio playback error:", e));
        } else {
            audioElement.pause();
        }
    }
  }, [isPlaying]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
        const handleEnded = () => {
            // Ensure onPlayPause is only called when it was actually playing
            if (!audioElement.paused) {
                onPlayPause();
            }
        };
        audioElement.addEventListener('ended', handleEnded);
        return () => {
            audioElement.removeEventListener('ended', handleEnded);
        }
    }
  }, [onPlayPause]);


  const renderContent = () => {
    switch(comment.type) {
        case 'text':
            return <p className="text-slate-200 mt-1 whitespace-pre-wrap"><TaggedContent text={comment.text || ''} onTagClick={onAuthorClick} /></p>;
        case 'image':
            return <img src={comment.imageUrl} alt="Comment image" className="mt-2 rounded-lg max-w-full h-auto max-h-60" />;
        case 'audio':
        default:
            return (
                <>
                    {comment.audioUrl && <audio ref={audioRef} src={comment.audioUrl} className="hidden" />}
                    <button 
                        onClick={onPlayPause}
                        aria-label={isPlaying ? 'Pause comment' : 'Play comment'}
                        className={`w-full h-12 mt-1 p-2 rounded-md flex items-center gap-3 text-white transition-colors ${isPlaying ? 'bg-sky-500/30' : 'bg-slate-600/50 hover:bg-slate-600'}`}
                    >
                        <Icon name={isPlaying ? 'pause' : 'play'} className="w-5 h-5 flex-shrink-0" />
                        <div className="h-full flex-grow">
                            <Waveform isPlaying={isPlaying} barCount={25} />
                        </div>
                        <span className="text-xs font-mono self-end pb-1">{comment.duration}s</span>
                    </button>
                </>
            );
    }
  };
  
  return (
    <div className="bg-slate-700/50 rounded-lg p-3 flex gap-3 items-start">
        <button onClick={() => onAuthorClick(comment.author.username)} className="flex-shrink-0 group">
            <img src={comment.author.avatarUrl} alt={comment.author.name} className="w-10 h-10 rounded-full transition-all group-hover:ring-2 group-hover:ring-sky-400" />
        </button>
        <div className="flex-grow">
            <div className="flex items-baseline gap-2">
                <button onClick={() => onAuthorClick(comment.author.username)} className="font-bold text-slate-200 hover:text-sky-300 transition-colors">{comment.author.name}</button>
                <span className="text-xs text-slate-400">{timeAgo}</span>
            </div>
            {renderContent()}
        </div>
    </div>
  );
};

export default CommentCard;
