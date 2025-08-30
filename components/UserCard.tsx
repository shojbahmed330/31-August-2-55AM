
import React from 'react';
import type { User } from '../types';

interface UserCardProps {
    user: User;
    onProfileClick: (username: string) => void;
    children: React.ReactNode; // For action buttons
}

const UserCard: React.FC<UserCardProps> = ({ user, onProfileClick, children }) => {
    return (
        <div className="bg-slate-800 rounded-lg p-4 flex flex-col sm:flex-row items-center gap-4 w-full">
            <button onClick={() => onProfileClick(user.username)} className="flex-shrink-0 group">
                <img src={user.avatarUrl} alt={user.name} className="w-20 h-20 rounded-full transition-all group-hover:ring-4 group-hover:ring-lime-500/50" />
            </button>
            <div className="flex-grow text-center sm:text-left">
                <button onClick={() => onProfileClick(user.username)}>
                    <p className="font-bold text-xl text-slate-100 hover:text-lime-400 transition-colors">{user.name}</p>
                </button>
                <p className="text-sm text-slate-400 mt-1">{user.bio}</p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2 mt-3 sm:mt-0">
                {children}
            </div>
        </div>
    );
}

export default UserCard;
