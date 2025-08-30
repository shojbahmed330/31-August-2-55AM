
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, ScrollState, FriendshipStatus, AppView } from '../types';
import { geminiService } from '../services/geminiService';
import Icon from './Icon';
import UserCard from './UserCard';
import { getTtsPrompt } from '../constants';
import { useSettings } from '../contexts/SettingsContext';

interface FriendsScreenProps {
  currentUser: User;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onOpenProfile: (username: string) => void;
  scrollState: ScrollState;
  onCommandProcessed: () => void;
  onNavigate: (view: AppView, props?: any) => void;
  onGoBack: () => void;
  initialTab?: ActiveTab;
}

type ActiveTab = 'requests' | 'suggestions' | 'all_friends';

const FriendsScreen: React.FC<FriendsScreenProps> = ({ currentUser, onSetTtsMessage, lastCommand, onOpenProfile, scrollState, onCommandProcessed, onNavigate, onGoBack, initialTab }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab || 'requests');
  const [requests, setRequests] = useState<User[]>([]);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [allFriends, setAllFriends] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { language } = useSettings();

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [reqs, suggs, friends] = await Promise.all([
      geminiService.getFriendRequests(currentUser.id),
      geminiService.getRecommendedFriends(currentUser.id),
      geminiService.getFriendsList(currentUser.id),
    ]);
    setRequests(reqs);
    setSuggestions(suggs);
    setAllFriends(friends);
    setIsLoading(false);
    
    // If no initial tab is provided, default based on data
    if (!initialTab) {
        if (reqs.length > 0) {
            setActiveTab('requests');
        } else if (suggs.length > 0) {
            setActiveTab('suggestions');
        } else {
            setActiveTab('all_friends');
        }
    }

  }, [currentUser.id, initialTab]);

  useEffect(() => {
    fetchData();
    onSetTtsMessage(getTtsPrompt('friends_loaded', language));
  }, [fetchData, onSetTtsMessage, language]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || scrollState === 'none') {
        return;
    }

    let animationFrameId: number;
    const animateScroll = () => {
        if (scrollState === 'down') {
            scrollContainer.scrollTop += 2;
        } else if (scrollState === 'up') {
            scrollContainer.scrollTop -= 2;
        }
        animationFrameId = requestAnimationFrame(animateScroll);
    };
    
    animationFrameId = requestAnimationFrame(animateScroll);

    return () => {
        cancelAnimationFrame(animationFrameId);
    };
  }, [scrollState]);

  const handleAccept = useCallback(async (requestingUser: User) => {
    await geminiService.acceptFriendRequest(currentUser.id, requestingUser.id);
    onSetTtsMessage(getTtsPrompt('friend_request_accepted', language, { name: requestingUser.name }));
    fetchData(); // Refresh all lists
  }, [currentUser.id, fetchData, onSetTtsMessage, language]);
  
  const handleDecline = useCallback(async (requestingUser: User) => {
    await geminiService.declineFriendRequest(currentUser.id, requestingUser.id);
    onSetTtsMessage(getTtsPrompt('friend_request_declined', language, { name: requestingUser.name }));
    fetchData(); // Refresh all lists
  }, [currentUser.id, fetchData, onSetTtsMessage, language]);
  
  const handleAddFriend = useCallback(async (targetUser: User) => {
    const result = await geminiService.addFriend(currentUser.id, targetUser.id);
     if (result.success) {
        onSetTtsMessage(getTtsPrompt('friend_request_sent', language, { name: targetUser.name }));
        fetchData(); // Refresh lists to show "Request Sent"
     } else {
         onSetTtsMessage(getTtsPrompt('friend_request_privacy_block', language, { name: targetUser.name }));
     }
  }, [currentUser.id, fetchData, onSetTtsMessage, language]);

  const handleCommand = useCallback(async (command: string) => {
    try {
        let contextUsers: User[] = [];
        if (activeTab === 'requests') contextUsers = requests;
        else if (activeTab === 'suggestions') contextUsers = suggestions;
        else if (activeTab === 'all_friends') contextUsers = allFriends;

        const intentResponse = await geminiService.processIntent(command, { userNames: contextUsers.map(u => u.name) });
        
        const { intent, slots } = intentResponse;

        if (slots?.target_name) {
            const targetName = slots.target_name as string;
            const targetUser = contextUsers.find(r => r.name.toLowerCase() === targetName.toLowerCase());

            if(targetUser) {
                if (intent === 'intent_accept_request') {
                    handleAccept(targetUser);
                    return; // early exit
                } else if (intent === 'intent_decline_request') {
                    handleDecline(targetUser);
                    return; // early exit
                } else if (intent === 'intent_add_friend') {
                    handleAddFriend(targetUser);
                    return; // early exit
                } else if (intent === 'intent_open_profile') {
                    onOpenProfile(targetUser.username);
                    return;
                }
            }
        }
        
        // Handle global commands if no specific friend action was taken
        switch (intent) {
            case 'intent_go_back':
                onGoBack();
                break;
            case 'intent_reload_page':
                onSetTtsMessage("Reloading friends list...");
                fetchData();
                break;
            case 'intent_open_ads_center':
                onNavigate(AppView.ADS_CENTER);
                break;
            case 'intent_open_messages':
                onNavigate(AppView.CONVERSATIONS);
                break;
            case 'intent_open_rooms_hub':
                onNavigate(AppView.ROOMS_HUB);
                break;
            case 'intent_open_audio_rooms':
                onNavigate(AppView.ROOMS_LIST);
                break;
            case 'intent_open_video_rooms':
                onNavigate(AppView.VIDEO_ROOMS_LIST);
                break;
            default:
                 onSetTtsMessage(getTtsPrompt('error_generic', language));
                break;
        }

    } catch (error) {
        console.error("Error processing command in FriendsScreen:", error);
        onSetTtsMessage(getTtsPrompt('error_generic', language));
    } finally {
        onCommandProcessed();
    }

  }, [requests, suggestions, allFriends, activeTab, handleAccept, handleDecline, handleAddFriend, onCommandProcessed, onNavigate, onSetTtsMessage, onGoBack, fetchData, onOpenProfile, language]);

  useEffect(() => {
    if (lastCommand) {
      handleCommand(lastCommand);
    }
  }, [lastCommand, handleCommand]);

  const renderContent = () => {
    if (isLoading) {
        return <div className="text-lime-500 text-center p-10">Loading...</div>;
    }
    
    let userList: User[] = [];
    if (activeTab === 'requests') userList = requests;
    if (activeTab === 'suggestions') userList = suggestions;
    if (activeTab === 'all_friends') userList = allFriends;

    if (userList.length === 0) {
        return <div className="text-lime-500 text-center p-10 bg-slate-900/50 rounded-b-lg border border-t-0 border-lime-500/20">No users to show in this list.</div>
    }

    return (
        <div className="flex flex-col gap-4 p-4 bg-slate-900/50 rounded-b-lg border border-t-0 border-lime-500/20">
            {userList.map(user => (
                <UserCard key={user.id} user={user} onProfileClick={onOpenProfile}>
                    {activeTab === 'requests' && (
                        <>
                           <button onClick={() => handleDecline(user)} className="px-3 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-lime-200 font-semibold transition-colors">Decline</button>
                           <button onClick={() => handleAccept(user)} className="px-3 py-2 text-sm rounded-lg bg-lime-600 hover:bg-lime-500 text-black font-bold transition-colors">Accept</button>
                        </>
                    )}
                     {activeTab === 'suggestions' && (
                        <>
                            {user.friendshipStatus === FriendshipStatus.REQUEST_SENT ? (
                               <button disabled className="px-3 py-2 text-sm rounded-lg bg-slate-700 text-lime-500 font-semibold cursor-not-allowed">Sent</button>
                            ) : (
                               <button onClick={() => handleAddFriend(user)} className="px-3 py-2 text-sm rounded-lg bg-lime-600 hover:bg-lime-500 text-black font-bold transition-colors flex items-center gap-2">
                                   <Icon name="add-friend" className="w-5 h-5" /> Add Friend
                               </button>
                            )}
                        </>
                    )}
                    {activeTab === 'all_friends' && (
                        <button onClick={() => onNavigate(AppView.MESSAGES, { recipient: user })} className="px-3 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-lime-200 font-semibold transition-colors">Message</button>
                    )}
                </UserCard>
            ))}
        </div>
    )
  }
  
  const TabButton: React.FC<{tabId: ActiveTab; label: string; count: number;}> = ({ tabId, label, count }) => (
    <button 
        onClick={() => setActiveTab(tabId)}
        className={`px-4 py-3 font-semibold text-lg border-b-4 transition-colors ${activeTab === tabId ? 'border-lime-500 text-lime-300' : 'border-transparent text-lime-500 hover:text-lime-300'}`}
    >
        {label} {count > 0 && <span className={`ml-2 text-sm px-2 py-0.5 rounded-full ${activeTab === tabId ? 'bg-lime-500 text-black' : 'bg-slate-700 text-lime-300'}`}>{count}</span>}
    </button>
  );

  return (
    <div ref={scrollContainerRef} className="h-full w-full overflow-y-auto p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-4 text-lime-200">Friends</h1>
        
        <div className="border-b border-lime-500/20 flex items-center bg-slate-900/50 rounded-t-lg">
            <TabButton tabId="requests" label="Friend Requests" count={requests.length} />
            <TabButton tabId="suggestions" label="Suggestions" count={suggestions.length} />
            <TabButton tabId="all_friends" label="All Friends" count={allFriends.length} />
        </div>
        
        {renderContent()}

      </div>
    </div>
  );
};

export default FriendsScreen;
