
import React from 'react';
import { User, AppView, VoiceState } from '../types';
import Icon from './Icon';

interface SidebarProps {
  currentUser: User;
  onNavigate: (viewName: 'feed' | 'explore' | 'reels' | 'friends' | 'settings' | 'profile' | 'messages' | 'ads_center' | 'rooms' | 'groups') => void;
  friendRequestCount: number;
  activeView: AppView;
  voiceCoins: number;
  voiceState: VoiceState;
  onMicClick: () => void;
}

const NavItem: React.FC<{
    iconName: React.ComponentProps<typeof Icon>['name'];
    label: string;
    isActive: boolean;
    badgeCount?: number;
    onClick: () => void;
}> = ({ iconName, label, isActive, badgeCount = 0, onClick }) => {
    return (
        <li>
            <button
                onClick={onClick}
                className={`w-full flex items-center gap-4 p-3 rounded-lg text-lg transition-colors ${
                    isActive
                        ? 'bg-lime-500/10 text-lime-300 font-bold'
                        : 'text-lime-400/80 hover:bg-slate-800 hover:text-lime-300'
                }`}
            >
                <Icon name={iconName} className="w-7 h-7" />
                <span>{label}</span>
                {badgeCount > 0 && (
                    <span className="ml-auto bg-lime-500 text-black text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center">
                        {badgeCount}
                    </span>
                )}
            </button>
        </li>
    );
};

const Sidebar: React.FC<SidebarProps> = ({ currentUser, onNavigate, friendRequestCount, activeView, voiceCoins, voiceState, onMicClick }) => {
  const getFabClass = () => {
    let base = "w-full text-black font-bold text-lg py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2";
    switch (voiceState) {
        case VoiceState.LISTENING:
            return `${base} bg-red-500 ring-4 ring-red-500/50 animate-pulse text-white`;
        case VoiceState.PROCESSING:
            return `${base} bg-yellow-600 cursor-not-allowed text-black`;
        default: // IDLE
            return `${base} bg-lime-600 hover:bg-lime-500`;
    }
  };

  const getFabIcon = () => {
    switch (voiceState) {
        case VoiceState.PROCESSING:
            return <Icon name="logo" className="w-6 h-6 animate-spin" />;
        case VoiceState.LISTENING:
        default:
            return <Icon name="mic" className="w-6 h-6" />;
    }
  };

  const getFabText = () => {
    switch (voiceState) {
        case VoiceState.PROCESSING:
            return "Processing...";
        case VoiceState.LISTENING:
            return "Listening...";
        default:
            return "Voice Command";
    }
  };

  return (
    <aside className="w-72 flex-shrink-0 hidden md:flex flex-col py-6">
      <div className="flex-grow">
        {/* Profile Section */}
        <button
            onClick={() => onNavigate('profile')}
            className="w-full flex items-center gap-4 p-3 rounded-lg text-left hover:bg-slate-800 mb-6 transition-colors"
        >
          <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-12 h-12 rounded-full" />
          <div>
            <p className="font-bold text-lime-200 text-lg">{currentUser.name}</p>
            <p className="text-sm text-lime-500">View Profile</p>
          </div>
        </button>

        {/* Navigation */}
        <nav>
          <ul className="space-y-2">
            <NavItem
                iconName="home"
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
                iconName="users"
                label="Friends"
                isActive={activeView === AppView.FRIENDS}
                badgeCount={friendRequestCount}
                onClick={() => onNavigate('friends')}
            />
             <NavItem
                iconName="users-group-solid"
                label="Groups"
                isActive={activeView === AppView.GROUPS_HUB || activeView === AppView.GROUP_PAGE}
                onClick={() => onNavigate('groups')}
            />
            <NavItem
                iconName="message"
                label="Messages"
                isActive={activeView === AppView.MESSAGES || activeView === AppView.CONVERSATIONS}
                onClick={() => onNavigate('messages')}
            />
            <NavItem
                iconName="chat-bubble-group"
                label="Rooms"
                isActive={activeView === AppView.ROOMS_LIST || activeView === AppView.LIVE_ROOM || activeView === AppView.ROOMS_HUB}
                onClick={() => onNavigate('rooms')}
            />
             <NavItem
                iconName="briefcase"
                label="Ads Center"
                isActive={activeView === AppView.ADS_CENTER}
                onClick={() => onNavigate('ads_center')}
            />
            <NavItem
                iconName="settings"
                label="Settings"
                isActive={activeView === AppView.SETTINGS}
                onClick={() => onNavigate('settings')}
            />
          </ul>
        </nav>
      </div>

      {/* Voice Coins */}
      <div className="mb-4 bg-slate-900 shadow-md rounded-lg flex items-center justify-between p-3 border border-lime-500/20">
          <div className="flex items-center gap-3">
              <Icon name="coin" className="w-8 h-8 text-yellow-400" />
              <div>
                  <p className="font-semibold text-lime-300">Voice Coins</p>
                  <p className="text-xs text-lime-500">For AI features</p>
              </div>
          </div>
          <p className="text-2xl font-bold text-yellow-400">{voiceCoins}</p>
      </div>


      {/* Voice Command Button */}
      <div className="flex-shrink-0">
        <button
          onClick={onMicClick}
          disabled={voiceState === VoiceState.PROCESSING}
          className={getFabClass()}
        >
            {getFabIcon()}
            <span>{getFabText()}</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
