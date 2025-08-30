
import React from 'react';
import { AppView, VoiceState } from '../types';
import Icon from './Icon';
import VoiceCommandInput from './VoiceCommandInput';

interface MobileBottomNavProps {
    onNavigate: (viewName: 'feed' | 'explore' | 'reels' | 'friends' | 'profile' | 'messages' | 'rooms' | 'groups' | 'menu') => void;
    friendRequestCount: number;
    activeView: AppView;
    voiceState: VoiceState;
    onMicClick: () => void;
    onSendCommand: (command: string) => void;
    commandInputValue: string;
    setCommandInputValue: (value: string) => void;
    ttsMessage: string;
}

const NavItem: React.FC<{
    iconName: React.ComponentProps<typeof Icon>['name'];
    label: string;
    isActive: boolean;
    badgeCount?: number;
    onClick: () => void;
}> = ({ iconName, label, isActive, badgeCount = 0, onClick }) => {
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center justify-center gap-1 w-full h-full transition-colors ${
                isActive ? 'text-lime-400' : 'text-slate-400 hover:text-lime-300'
            }`}
        >
            <div className="relative">
                <Icon name={iconName} className="w-7 h-7" />
                {badgeCount > 0 && (
                    <span className="absolute -top-1 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-lime-500 text-xs font-bold text-black border border-slate-900">{badgeCount}</span>
                )}
            </div>
            <span className="text-xs">{label}</span>
        </button>
    );
};


const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onNavigate, friendRequestCount, activeView, voiceState, onMicClick, onSendCommand, commandInputValue, setCommandInputValue, ttsMessage }) => {
    return (
        <div className="fixed bottom-0 left-0 right-0 h-auto bg-gradient-to-t from-black to-slate-900 border-t border-lime-500/20 z-40 md:hidden flex flex-col">
            {/* The new, persistent command input bar for mobile */}
            <VoiceCommandInput
                onSendCommand={onSendCommand}
                voiceState={voiceState}
                onMicClick={onMicClick}
                value={commandInputValue}
                onValueChange={setCommandInputValue}
                placeholder={ttsMessage}
            />
            {/* The 5-button navigation bar */}
            <div className="flex justify-around items-center h-16">
                <NavItem
                    iconName="home-solid"
                    label="Home"
                    isActive={activeView === AppView.FEED}
                    onClick={() => onNavigate('feed')}
                />
                 <NavItem
                    iconName="compass"
                    label="Explore"
                    isActive={activeView === AppView.EXPLORE}
                    onClick={() => onNavigate('explore')}
                />
                <NavItem
                    iconName="film"
                    label="Reels"
                    isActive={activeView === AppView.REELS}
                    onClick={() => onNavigate('reels')}
                />
                 <NavItem
                    iconName="message"
                    label="Messages"
                    isActive={activeView === AppView.MESSAGES || activeView === AppView.CONVERSATIONS}
                    onClick={() => onNavigate('messages')}
                />
                <NavItem
                    iconName="ellipsis-vertical"
                    label="Menu"
                    isActive={activeView === AppView.MOBILE_MENU}
                    onClick={() => onNavigate('menu')}
                />
            </div>
        </div>
    );
};

export default MobileBottomNav;
