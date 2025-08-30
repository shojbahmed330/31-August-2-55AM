
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppView, User, VoiceState, Post, Comment, ScrollState, Notification, Campaign, Group, Story } from './types';
import AuthScreen from './components/AuthScreen';
import FeedScreen from './components/FeedScreen';
import ExploreScreen from './components/ExploreScreen';
import ReelsScreen from './components/ReelsScreen';
import CreatePostScreen from './components/CreatePostScreen';
import CreateReelScreen from './components/CreateReelScreen';
import CreateCommentScreen from './components/CreateCommentScreen';
import ProfileScreen from './components/ProfileScreen';
import SettingsScreen from './components/SettingsScreen';
import MessageScreen from './components/MessageScreen';
import PostDetailScreen from './components/PostDetailScreen';
import FriendsScreen from './components/FriendsScreen';
import SearchResultsScreen from './components/SearchResultsScreen';
import VoiceCommandInput from './components/VoiceCommandInput';
import NotificationPanel from './components/NotificationPanel';
import Sidebar from './components/Sidebar';
import Icon from './components/Icon';
import AdModal from './components/AdModal';
import { geminiService } from './services/geminiService';
import { firebaseService } from './services/firebaseService';
import { IMAGE_GENERATION_COST, REWARD_AD_COIN_VALUE, getTtsPrompt } from './constants';
import ConversationsScreen from './components/ConversationsScreen';
import AdsScreen from './components/AdsScreen';
import CampaignViewerModal from './components/CampaignViewerModal';
import MobileBottomNav from './components/MobileBottomNav';
import RoomsHubScreen from './components/RoomsHubScreen';
import RoomsListScreen from './components/RoomsListScreen';
import LiveRoomScreen from './components/LiveRoomScreen';
import VideoRoomsListScreen from './components/VideoRoomsListScreen';
import LiveVideoRoomScreen from './components/LiveVideoRoomScreen';
import GroupsHubScreen from './components/GroupsHubScreen';
import GroupPageScreen from './components/GroupPageScreen';
import ManageGroupScreen from './components/ManageGroupScreen';
import GroupChatScreen from './components/GroupChatScreen';
import GroupEventsScreen from './components/GroupEventsScreen';
import CreateEventScreen from './components/CreateEventScreen';
import CreateStoryScreen from './components/CreateStoryScreen';
import StoryViewerScreen from './components/StoryViewerScreen';
import StoryPrivacyScreen from './components/StoryPrivacyScreen';
import GroupInviteScreen from './components/GroupInviteScreen';
import ContactsPanel from './components/ContactsPanel';
import ShareModal from './components/ShareModal';
import LeadFormModal from './components/LeadFormModal';
import { useSettings } from './contexts/SettingsContext';


interface ViewState {
  view: AppView;
  props?: any;
}

const MenuItem: React.FC<{
    iconName: React.ComponentProps<typeof Icon>['name'];
    label: string;
    onClick: () => void;
    badge?: string | number;
}> = ({ iconName, label, onClick, badge }) => (
    <button onClick={onClick} className="w-full flex items-center gap-4 p-4 text-left text-lg text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
        <Icon name={iconName} className="w-7 h-7 text-gray-500" />
        <span className="flex-grow">{label}</span>
        {badge !== undefined && Number(badge) > 0 && <span className="text-sm font-bold bg-red-500 text-white rounded-full px-2 py-0.5">{badge}</span>}
        {badge !== undefined && Number(badge) === 0 && <span className="text-sm font-bold text-yellow-500">{badge}</span>}
    </button>
);

const MobileMenuScreen: React.FC<{
  currentUser: User;
  onNavigate: (view: AppView, props?: any) => void;
  onLogout: () => void;
  friendRequestCount: number;
}> = ({ currentUser, onNavigate, onLogout, friendRequestCount }) => {
    return (
        <div className="h-full w-full overflow-y-auto p-4 bg-slate-100 text-gray-800">
            <div className="max-w-md mx-auto">
                <button 
                    onClick={() => onNavigate(AppView.PROFILE, { username: currentUser.username })}
                    className="w-full flex items-center gap-4 p-4 mb-6 rounded-lg bg-white hover:bg-gray-50 transition-colors border border-gray-200"
                >
                    <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-16 h-16 rounded-full" />
                    <div>
                        <h2 className="text-2xl font-bold">{currentUser.name}</h2>
                        <p className="text-gray-500">View your profile</p>
                    </div>
                </button>

                <div className="space-y-2 bg-white p-2 rounded-lg border border-gray-200">
                    <MenuItem 
                        iconName="users" 
                        label="Friends" 
                        onClick={() => onNavigate(AppView.FRIENDS)}
                        badge={friendRequestCount}
                    />
                    <MenuItem 
                        iconName="coin" 
                        label="Voice Coins" 
                        onClick={() => {}}
                        badge={currentUser.voiceCoins || 0}
                    />
                     <MenuItem 
                        iconName="settings" 
                        label="Settings" 
                        onClick={() => onNavigate(AppView.SETTINGS)}
                    />
                    <MenuItem 
                        iconName="users-group-solid" 
                        label="Groups" 
                        onClick={() => onNavigate(AppView.GROUPS_HUB)}
                    />
                    <MenuItem 
                        iconName="briefcase" 
                        label="Ads Center" 
                        onClick={() => onNavigate(AppView.ADS_CENTER)}
                    />
                    <MenuItem 
                        iconName="chat-bubble-group" 
                        label="Rooms" 
                        onClick={() => onNavigate(AppView.ROOMS_HUB)}
                    />
                </div>

                <div className="mt-8 border-t border-gray-200 pt-4">
                     <button onClick={onLogout} className="w-full flex items-center gap-4 p-4 text-left text-lg text-red-600 hover:bg-red-500/10 rounded-lg transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                        </svg>
                        <span>Logout</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


const UserApp: React.FC = () => {
  const [viewStack, setViewStack] = useState<ViewState[]>([{ view: AppView.AUTH }]);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [globalAuthError, setGlobalAuthError] = useState('');
  
  const [friends, setFriends] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reelsPosts, setReelsPosts] = useState<Post[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isNotificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [isProfileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const [campaignForAd, setCampaignForAd] = useState<Campaign | null>(null);
  const [viewingAd, setViewingAd] = useState<Post | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>(VoiceState.IDLE);
  const [ttsMessage, setTtsMessage] = useState<string>('');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [scrollState, setScrollState] = useState<ScrollState>('none');
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);
  const [isLoadingReels, setIsLoadingReels] = useState(true);
  const [commandInputValue, setCommandInputValue] = useState('');
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [navigateToGroupId, setNavigateToGroupId] = useState<string | null>(null);
  const [initialDeepLink, setInitialDeepLink] = useState<ViewState | null>(null);
  const [shareModalPost, setShareModalPost] = useState<Post | null>(null);
  const [leadFormPost, setLeadFormPost] = useState<Post | null>(null);
  const { language } = useSettings();
  
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null); // To hold the active speech recognition instance
  const currentView = viewStack[viewStack.length - 1];
  const unreadNotificationCount = notifications.filter(n => !n.read).length;
  const friendRequestCount = (currentView?.props?.requests as User[] || []).length; // Used for badge on sidebar

  useEffect(() => {
    const hash = window.location.hash;
    const postMatch = hash.match(/^#\/post\/([\w-]+)/);
    if (postMatch && postMatch[1]) {
        setInitialDeepLink({ view: AppView.POST_DETAILS, props: { postId: postMatch[1] } });
    }
  }, []);

  useEffect(() => {
    let unsubscribePosts = () => {};
    let unsubscribeReelsPosts = () => {};
    let unsubscribeFriends = () => {};
    let unsubscribeNotifications = () => {};
    let activityInterval: number | null = null;

    const unsubscribeAuth = firebaseService.onAuthStateChanged(async (userProfile) => {
        unsubscribePosts();
        unsubscribeReelsPosts();
        unsubscribeFriends();
        unsubscribeNotifications();
        if (activityInterval) clearInterval(activityInterval);

        if (userProfile) {
            setUser(userProfile);
            if (!initialDeepLink) {
                setTtsMessage(getTtsPrompt('login_success', language, { name: userProfile.name }));
            }

            if (initialDeepLink) {
                setViewStack([initialDeepLink]);
                setInitialDeepLink(null); // Consume deep link
            } else if (currentView?.view === AppView.AUTH) {
                setViewStack([{ view: AppView.FEED }]);
            }

            // Set up real-time listeners
            setIsLoadingFeed(true);
            setIsLoadingReels(true);
            unsubscribePosts = firebaseService.listenToFeedPosts(userProfile.id, (feedPosts) => {
                setPosts(feedPosts);
                setIsLoadingFeed(false);
            });
            unsubscribeReelsPosts = firebaseService.listenToReelsPosts((newReelsPosts) => {
                setReelsPosts(newReelsPosts);
                setIsLoadingReels(false);
            });
            unsubscribeFriends = firebaseService.listenToFriends(userProfile.id, (friendsList) => {
                setFriends(friendsList);
            });
            unsubscribeNotifications = firebaseService.listenToNotifications(userProfile.id, (newNotifications) => {
                setNotifications(newNotifications);
            });
            // Set up user activity tracking
            firebaseService.updateUserLastActive(userProfile.id); // Update immediately
            activityInterval = window.setInterval(() => {
                firebaseService.updateUserLastActive(userProfile.id);
            }, 60 * 1000); // Update every 60 seconds
        } else {
            setUser(null);
            setPosts([]);
            setReelsPosts([]);
            setFriends([]);
            setNotifications([]);
            setViewStack([{ view: AppView.AUTH }]);
        }
        setIsAuthLoading(false);
    });

    return () => {
        unsubscribeAuth();
        unsubscribePosts();
        unsubscribeReelsPosts();
        unsubscribeFriends();
        unsubscribeNotifications();
        if (activityInterval) clearInterval(activityInterval);
    };
  }, [currentView?.view, initialDeepLink, language]);

  useEffect(() => {
    setTtsMessage(getTtsPrompt('welcome', language));
  }, [language]);

  const navigate = useCallback((view: AppView, props: any = {}) => {
    setNotificationPanelOpen(false);
    setProfileMenuOpen(false);
    setViewStack(stack => [...stack, { view, props }]);
  }, []);
  
  // This effect ensures that if the user logs out, they are returned to the Auth screen.
  useEffect(() => {
    if (!user && !isAuthLoading && currentView?.view !== AppView.AUTH) {
        setViewStack([{ view: AppView.AUTH }]);
    }
  }, [user, isAuthLoading, currentView]);

  const goBack = () => {
    if (viewStack.length > 1) {
      setViewStack(stack => stack.slice(0, -1));
    }
  };
  
  const handleStartMessage = (recipient: User) => navigate(AppView.MESSAGES, { recipient, ttsMessage: getTtsPrompt('message_screen_loaded', language, { name: recipient.name }) });

  const handleCommand = useCallback((command: string) => {
    setVoiceState(VoiceState.PROCESSING);
    setScrollState('none');
    setLastCommand(command);
    setCommandInputValue('');
  }, []);

  const handleCommandProcessed = useCallback(() => {
    setLastCommand(null);
    setVoiceState(VoiceState.IDLE);
  }, []);

  const handleMicClick = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTtsMessage(getTtsPrompt('error_no_speech_rec', language));
      return;
    }

    if (voiceState === VoiceState.LISTENING) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    if (voiceState === VoiceState.PROCESSING) {
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = 'bn-BD, en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceState(VoiceState.LISTENING);
      setCommandInputValue(''); // Clear previous text on new recording
      setTtsMessage("Listening...");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceState(currentVoiceState => {
        if (currentVoiceState === VoiceState.LISTENING) { 
            return VoiceState.IDLE;
        }
        return currentVoiceState;
      });
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setTtsMessage(getTtsPrompt('error_mic_permission', language));
      } else {
        setTtsMessage(getTtsPrompt('error_generic', language));
      }
    };

    recognition.onresult = (event: any) => {
      const command = event.results[0][0].transcript;
      handleCommand(command);
    };

    recognition.start();
  }, [voiceState, handleCommand, language]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (notificationPanelRef.current && !notificationPanelRef.current.contains(event.target as Node)) {
            setNotificationPanelOpen(false);
        }
        if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
            setProfileMenuOpen(false);
        }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  
  const handleLogout = () => {
    firebaseService.signOutUser();
    setUser(null);
    setPosts([]);
    setFriends([]);
    setGroups([]);
    setNotifications([]);
    setViewStack([{ view: AppView.AUTH }]);
  };
  
  const handleToggleNotifications = async () => {
      const isOpen = !isNotificationPanelOpen;
      setNotificationPanelOpen(isOpen);
      if (isOpen && user) {
          const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
          if (unreadIds.length > 0) {
              await firebaseService.markNotificationsAsRead(user.id, unreadIds);
          }
      }
  }

  const handleNotificationClick = (notification: Notification) => {
    setNotificationPanelOpen(false);
    
    switch(notification.type) {
        case 'like':
        case 'comment':
            if (notification.post?.id) {
                navigate(AppView.POST_DETAILS, { postId: notification.post.id });
            }
            break;
        case 'friend_request':
            navigate(AppView.FRIENDS, { initialTab: 'requests' });
            break;
        case 'group_post':
        case 'group_request_approved':
            if (notification.groupId) {
                navigate(AppView.GROUP_PAGE, { groupId: notification.groupId });
            }
            break;
        case 'group_join_request':
            if (notification.groupId) {
                // This is for admins/mods. Navigate to the management screen.
                navigate(AppView.MANAGE_GROUP, { groupId: notification.groupId, initialTab: 'requests' });
            }
            break;
        case 'campaign_approved':
        case 'campaign_rejected':
            navigate(AppView.ADS_CENTER);
            break;
        case 'admin_announcement':
        case 'admin_warning':
            if (notification.message) {
                setTtsMessage(notification.message);
                alert(`[Admin Message] ${notification.message}`);
            }
            break;
        default:
            console.warn("Unhandled notification type:", notification.type);
            break;
    }
  }
  
  const handleRewardedAdClick = async (campaign: Campaign) => {
      setCampaignForAd(campaign);
      setIsShowingAd(true);
  };

  const handleAdViewed = (campaignId: string) => {
      firebaseService.trackAdView(campaignId);
  };

  const handleAdComplete = async (campaignId?: string) => {
      if (!user) return;
      
      setIsShowingAd(false);
      setCampaignForAd(null);

      const success = await geminiService.updateVoiceCoins(user.id, REWARD_AD_COIN_VALUE);

      if (success) {
          // Manually update the user state to reflect the coin change immediately
          setUser(prevUser => {
              if (!prevUser) return null;
              return {
                  ...prevUser,
                  voiceCoins: (prevUser.voiceCoins || 0) + REWARD_AD_COIN_VALUE
              };
          });
          setTtsMessage(getTtsPrompt('reward_claim_success', language, { coins: REWARD_AD_COIN_VALUE }));
          if (campaignId) {
            // Optional: can track that this campaign was completed by the user
          }
      } else {
          setTtsMessage(getTtsPrompt('transaction_failed', language));
      }
  };

  const handleAdSkip = () => {
    setIsShowingAd(false);
    setCampaignForAd(null);
    setTtsMessage("Ad skipped. No reward was earned.");
  };

  const handleDeductCoinsForImage = async (): Promise<boolean> => {
    if (!user) return false;
    return await geminiService.updateVoiceCoins(user.id, -IMAGE_GENERATION_COST);
  };

  const handleAdClick = async (post: Post) => {
    if (!post.isSponsored || !post.campaignId) return;

    // 1. Track the click
    await firebaseService.trackAdClick(post.campaignId);
    
    // 2. Perform the action
    if (post.allowLeadForm) {
        setTtsMessage(getTtsPrompt('lead_form_opened', language));
        setLeadFormPost(post);
    } else if (post.websiteUrl) {
        setTtsMessage(`Opening link for ${post.sponsorName}...`);
        window.open(post.websiteUrl, '_blank', 'noopener,noreferrer');
    } else if (post.allowDirectMessage && post.sponsorId) {
        const sponsorUser = await firebaseService.getUserProfileById(post.sponsorId);
        if (sponsorUser) {
            setTtsMessage(`Opening conversation with ${sponsorUser.name}.`);
            navigate(AppView.MESSAGES, { recipient: sponsorUser });
        } else {
            setTtsMessage(`Could not find sponsor ${post.sponsorName}.`);
        }
    } else if (post.sponsorId) {
        // Fallback to profile view if sponsorId exists but other actions don't
        const sponsorUser = await firebaseService.getUserProfileById(post.sponsorId);
        if (sponsorUser) {
            setTtsMessage(`Opening profile for ${sponsorUser.name}.`);
            navigate(AppView.PROFILE, { username: sponsorUser.username });
        } else {
            setTtsMessage(`Could not find sponsor ${post.sponsorName}.`);
        }
    } else {
        setTtsMessage(`Thank you for your interest in ${post.sponsorName}.`);
    }
  };

  const handleLeadSubmit = async (leadData: { name: string, email: string, phone: string }) => {
    if (!user || !leadFormPost || !leadFormPost.campaignId || !leadFormPost.sponsorId) {
        setTtsMessage(getTtsPrompt('lead_form_error', language));
        return;
    }
    
    try {
        await firebaseService.submitLead({
            campaignId: leadFormPost.campaignId,
            sponsorId: leadFormPost.sponsorId,
            userName: leadData.name,
            userEmail: leadData.email,
            userPhone: leadData.phone || undefined,
            createdAt: new Date().toISOString(),
        });
        setLeadFormPost(null);
        setTtsMessage(getTtsPrompt('lead_form_submitted', language));
    } catch (error) {
        console.error("Failed to submit lead:", error);
        setTtsMessage(getTtsPrompt('lead_form_error', language));
    }
  };

  const handleStartCreatePost = (props: any = {}) => {
    navigate(AppView.CREATE_POST, props);
  };
  
  const handlePostCreated = (newPost: Post | null) => {
    goBack();
    // The listener will automatically update the posts state.
    // We no longer need to manually add the post to the local state.
    setTtsMessage(getTtsPrompt('post_success', language));
  };

  const handleReelCreated = () => {
    goBack();
    setTtsMessage("Your Reel has been posted!");
  };

  const handleStoryCreated = (newStory: Story) => {
    goBack();
    setTtsMessage(getTtsPrompt('story_created', language));
  }
  
  const handleGroupCreated = (newGroup: Group) => {
    navigate(AppView.GROUP_PAGE, { groupId: newGroup.id });
  };

  const handleCurrentUserUpdate = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const handleUpdateSettings = async (settings: Partial<User>) => {
    if(user) {
        await geminiService.updateProfile(user.id, settings);
        const updatedUser = await geminiService.getUserById(user.id);
        if (updatedUser) setUser(updatedUser);
    }
  };
  
  const handleCommentPosted = (newComment: Comment | null, postId: string) => {
    if (newComment === null) {
        setTtsMessage(getTtsPrompt('comment_suspended', language));
        goBack();
        return;
    }
    // Go back to the post detail screen, and pass the new comment ID to highlight it
    setViewStack(stack => [...stack.slice(0, -1), { view: AppView.POST_DETAILS, props: { postId, newlyAddedCommentId: newComment.id } }]);
    setTtsMessage(getTtsPrompt('comment_post_success', language));
  }
  
  const handleReactToPost = async (postId: string, emoji: string) => {
    if (!user) return;
    const success = await firebaseService.reactToPost(postId, user.id, emoji);
    if (success) {
      // The real-time listener will update the UI, so no need for a TTS message here
      // unless we want explicit feedback.
      // setTtsMessage(`Reacted with ${emoji}`);
    } else {
      setTtsMessage(`Could not react. You may be offline.`);
    }
  }

  const handleSharePost = async (post: Post) => {
    const postUrl = `${window.location.origin}${window.location.pathname}#/post/${post.id}`;
    const shareData = {
        title: `Post by ${post.author.name} on VoiceBook`,
        text: post.caption ? (post.caption.substring(0, 100) + (post.caption.length > 100 ? '...' : '')) : 'Check out this post on VoiceBook!',
        url: postUrl,
    };

    if (navigator.share) {
        try {
            await navigator.share(shareData);
            setTtsMessage("Post shared successfully!");
        } catch (err) {
            console.log("Web Share API was cancelled or failed.", err);
        }
    } else {
        // Fallback to a custom share modal for desktop browsers
        setShareModalPost(post);
        setTtsMessage("Share options are now open.");
    }
  };


  const handleOpenProfile = (username: string) => navigate(AppView.PROFILE, { username });
  const handleViewPost = (postId: string) => navigate(AppView.POST_DETAILS, { postId });
  const handleEditProfile = () => navigate(AppView.SETTINGS, { ttsMessage: getTtsPrompt('settings_opened', language) });
  const handleStartComment = (postId: string) => {
    if(user?.commentingSuspendedUntil && new Date(user.commentingSuspendedUntil) > new Date()) {
        setTtsMessage(getTtsPrompt('comment_suspended', language));
        return;
    }
    navigate(AppView.CREATE_COMMENT, { postId });
  }
  const handleOpenConversation = async (peer: User) => {
    if (!user) return;
    navigate(AppView.MESSAGES, { recipient: peer, ttsMessage: getTtsPrompt('message_screen_loaded', language, { name: peer.name }) });
  };
  
    const handleBlockUser = async (userToBlock: User) => {
        if (!user) return;
        const success = await geminiService.blockUser(user.id, userToBlock.id);
        if (success) {
            setUser(u => u ? { ...u, blockedUserIds: [...u.blockedUserIds, userToBlock.id] } : null);
            setTtsMessage(getTtsPrompt('user_blocked', language, { name: userToBlock.name }));
            goBack();
        }
    };

    const handleUnblockUser = async (userToUnblock: User) => {
        if (!user) return;
        const success = await geminiService.unblockUser(user.id, userToUnblock.id);
        if (success) {
            setUser(u => u ? { ...u, blockedUserIds: u.blockedUserIds.filter(id => id !== userToUnblock.id) } : null);
            setTtsMessage(getTtsPrompt('user_unblocked', language, { name: userToUnblock.name }));
        }
    };

    const handleDeactivateAccount = async () => {
        if (!user) return;
        const success = await geminiService.deactivateAccount(user.id);
        if (success) {
            setTtsMessage(getTtsPrompt('account_deactivated', language));
            handleLogout();
        }
    };

  const handleNavigation = (viewName: 'feed' | 'explore' | 'reels' | 'friends' | 'settings' | 'profile' | 'messages' | 'ads_center' | 'rooms' | 'groups' | 'menu') => {
    setNotificationPanelOpen(false);
    switch(viewName) {
        case 'feed': setViewStack([{ view: AppView.FEED }]); break;
        case 'explore': setViewStack([{ view: AppView.EXPLORE }]); break;
        case 'reels': setViewStack([{ view: AppView.REELS }]); break;
        case 'friends': navigate(AppView.FRIENDS); break;
        case 'settings': navigate(AppView.SETTINGS); break;
        case 'profile': if (user) navigate(AppView.PROFILE, { username: user.username }); break;
        case 'messages': navigate(AppView.CONVERSATIONS); break;
        case 'ads_center': navigate(AppView.ADS_CENTER); break;
        case 'rooms': navigate(AppView.ROOMS_HUB); break;
        case 'groups': navigate(AppView.GROUPS_HUB); break;
        case 'menu': navigate(AppView.MOBILE_MENU); break;
    }
  }
  
  const handleHeaderSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = headerSearchQuery.trim();
    if (!query) return;
    const results = await geminiService.searchUsers(query);
    setSearchResults(results);
    navigate(AppView.SEARCH_RESULTS, { query });
    setHeaderSearchQuery('');
    setIsMobileSearchOpen(false);
  };

  const renderView = () => {
    if (isAuthLoading) {
        return <div className="flex items-center justify-center h-full text-lime-400">Loading VoiceBook...</div>;
    }
    if (!user) {
        return <AuthScreen 
            onSetTtsMessage={setTtsMessage}
            lastCommand={lastCommand}
            onCommandProcessed={handleCommandProcessed}
            initialAuthError={globalAuthError}
        />;
    }

    const commonScreenProps = {
      currentUser: user,
      onSetTtsMessage: setTtsMessage,
      lastCommand: lastCommand,
      onCommandProcessed: handleCommandProcessed,
      scrollState: scrollState,
      onSetScrollState: setScrollState,
      onGoBack: goBack,
      onNavigate: navigate,
      onOpenProfile: handleOpenProfile,
      onStartComment: handleStartComment,
      onSharePost: handleSharePost,
    };

    switch (currentView.view) {
      case AppView.AUTH:
        return <AuthScreen
            onSetTtsMessage={setTtsMessage}
            lastCommand={lastCommand}
            onCommandProcessed={handleCommandProcessed}
            initialAuthError={globalAuthError}
        />;
      case AppView.FEED:
        return <FeedScreen {...commonScreenProps} posts={posts} isLoading={isLoadingFeed} onReactToPost={handleReactToPost} onStartCreatePost={handleStartCreatePost} onRewardedAdClick={handleRewardedAdClick} onAdClick={handleAdClick} onAdViewed={handleAdViewed} onViewPost={handleViewPost} friends={friends} setSearchResults={setSearchResults} />;
      case AppView.EXPLORE:
        return <ExploreScreen {...commonScreenProps} onReactToPost={handleReactToPost} onViewPost={handleViewPost} />;
      case AppView.REELS:
        return <ReelsScreen {...commonScreenProps} posts={reelsPosts} isLoading={isLoadingReels} onReactToPost={handleReactToPost} onViewPost={handleViewPost} onStartComment={handleStartComment} onNavigate={navigate} />;
      case AppView.PROFILE:
        return <ProfileScreen {...commonScreenProps} username={currentView.props.username} onStartMessage={handleStartMessage} onEditProfile={handleEditProfile} onViewPost={handleViewPost} onReactToPost={handleReactToPost} onCurrentUserUpdate={handleCurrentUserUpdate} onPostCreated={handlePostCreated} onBlockUser={handleBlockUser} />;
      case AppView.POST_DETAILS:
        return <PostDetailScreen {...commonScreenProps} postId={currentView.props.postId} newlyAddedCommentId={currentView.props.newlyAddedCommentId} onStartComment={handleStartComment} onReactToPost={handleReactToPost} />;
      case AppView.FRIENDS:
        return <FriendsScreen {...commonScreenProps} />;
      case AppView.SEARCH_RESULTS:
        return <SearchResultsScreen {...commonScreenProps} results={searchResults} query={currentView.props.query} />;
      case AppView.SETTINGS:
        return <SettingsScreen {...commonScreenProps} onUpdateSettings={handleUpdateSettings} onUnblockUser={handleUnblockUser} onDeactivateAccount={handleDeactivateAccount} />;
      case AppView.CREATE_POST:
        return <CreatePostScreen {...commonScreenProps} user={user!} onPostCreated={handlePostCreated} onDeductCoinsForImage={handleDeductCoinsForImage} {...currentView.props} />;
      case AppView.CREATE_REEL:
        return <CreateReelScreen {...commonScreenProps} onReelCreated={handleReelCreated} />;
      case AppView.CREATE_COMMENT:
        return <CreateCommentScreen {...commonScreenProps} user={user!} postId={currentView.props.postId} onCommentPosted={handleCommentPosted} />;
      case AppView.CONVERSATIONS:
        return <ConversationsScreen {...commonScreenProps} onOpenConversation={handleOpenConversation} />;
      case AppView.MESSAGES:
        return <MessageScreen {...commonScreenProps} recipientUser={currentView.props.recipient} onGoBack={goBack} onBlockUser={handleBlockUser}/>;
      case AppView.ADS_CENTER:
        return <AdsScreen {...commonScreenProps} />;
      case AppView.ROOMS_HUB:
        return <RoomsHubScreen {...commonScreenProps} />;
      case AppView.ROOMS_LIST:
        return <RoomsListScreen {...commonScreenProps} />;
      case AppView.LIVE_ROOM:
        return <LiveRoomScreen {...commonScreenProps} roomId={currentView.props.roomId} />;
      case AppView.VIDEO_ROOMS_LIST:
        return <VideoRoomsListScreen {...commonScreenProps} />;
      case AppView.LIVE_VIDEO_ROOM:
        return <LiveVideoRoomScreen {...commonScreenProps} roomId={currentView.props.roomId} />;
      case AppView.GROUPS_HUB:
        return <GroupsHubScreen {...commonScreenProps} groups={groups} onGroupCreated={handleGroupCreated} />;
      case AppView.GROUP_PAGE:
        return <GroupPageScreen {...commonScreenProps} groupId={currentView.props.groupId} onStartCreatePost={handleStartCreatePost} onViewPost={handleViewPost} onReactToPost={handleReactToPost}/>;
      case AppView.MANAGE_GROUP:
        return <ManageGroupScreen {...commonScreenProps} groupId={currentView.props.groupId} initialTab={currentView.props.initialTab} />;
      case AppView.GROUP_CHAT:
        return <GroupChatScreen {...commonScreenProps} groupId={currentView.props.groupId} />;
      case AppView.GROUP_EVENTS:
        return <GroupEventsScreen {...commonScreenProps} groupId={currentView.props.groupId} />;
      case AppView.CREATE_EVENT:
        return <CreateEventScreen {...commonScreenProps} groupId={currentView.props.groupId} />;
      case AppView.CREATE_STORY:
        return <CreateStoryScreen {...commonScreenProps} onStoryCreated={handleStoryCreated} />;
      case AppView.STORY_VIEWER:
        return <StoryViewerScreen {...commonScreenProps} storiesByAuthor={currentView.props.storiesByAuthor} initialUserIndex={currentView.props.initialUserIndex} />;
      case AppView.STORY_PRIVACY:
        return <StoryPrivacyScreen {...commonScreenProps} {...currentView.props} />;
      case AppView.MOBILE_MENU:
        return <MobileMenuScreen currentUser={user} onNavigate={navigate} onLogout={handleLogout} friendRequestCount={friendRequestCount} />;
      case AppView.GROUP_INVITE:
        return <GroupInviteScreen {...commonScreenProps} groupId={currentView.props.groupId} />;
      default:
        return <div className="text-lime-400 p-8">Unknown view</div>;
    }
  };


  return (
    <div className={`h-screen w-screen flex flex-col ${user ? 'bg-black text-lime-300' : 'bg-slate-100 text-gray-800'}`}>
      <header className={`flex-shrink-0 p-2 flex justify-between items-center gap-4 z-20 ${!user ? 'bg-black' : 'bg-black/80 backdrop-blur-sm border-b border-lime-500/30'}`}>
        {isMobileSearchOpen && user ? (
            <div className="flex items-center w-full gap-2">
                 <button onClick={() => setIsMobileSearchOpen(false)} aria-label="Go back" className={`p-2 rounded-full transition-colors hover:bg-slate-800`}>
                    <Icon name="back" className="w-6 h-6 text-lime-500"/>
                </button>
                <form onSubmit={handleHeaderSearchSubmit} className="flex-grow relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                        <svg className="w-5 h-5 text-lime-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
                        </svg>
                    </div>
                    <input 
                        type="search"
                        autoFocus
                        value={headerSearchQuery}
                        onChange={(e) => setHeaderSearchQuery(e.target.value)}
                        placeholder="Search VoiceBook..."
                        className={`text-base rounded-full block w-full pl-11 p-2.5 transition bg-slate-900 border border-lime-500/30 text-lime-300 focus:ring-lime-500 focus:border-lime-500`}
                    />
                </form>
            </div>
        ) : (
           <>
             <div className="flex items-center gap-3 flex-shrink-0">
                {viewStack.length > 1 && ![AppView.MESSAGES, AppView.LIVE_ROOM, AppView.LIVE_VIDEO_ROOM].includes(currentView?.view) && !user ? (
                <button onClick={goBack} aria-label="Go back" className={`p-2 rounded-full transition-colors hover:bg-slate-800`}>
                    <Icon name="back" className="w-6 h-6 text-lime-500"/>
                </button>
                ) : (
                <button onClick={() => user ? setViewStack([{ view: AppView.FEED }]) : {}} className="flex items-center gap-2">
                    <Icon name="logo" className={`w-10 h-10 ml-2 text-lime-400`} />
                    <h1 className={`text-2xl font-bold text-lime-400 text-shadow-lg ${!user ? 'md:hidden' : ''}`}>VoiceBook</h1>
                </button>
                )}
                 {user && (
                    <div className="flex-grow max-w-xs hidden md:block">
                            <form onSubmit={handleHeaderSearchSubmit} className="relative">
                                <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                                    <svg className="w-5 h-5 text-lime-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
                                    </svg>
                                </div>
                                <input 
                                    type="search"
                                    value={headerSearchQuery}
                                    onChange={(e) => setHeaderSearchQuery(e.target.value)}
                                    placeholder="Search VoiceBook..."
                                    className={`text-base rounded-full block w-full pl-11 p-2.5 transition bg-slate-900 border border-lime-500/30 text-lime-300 focus:ring-lime-500 focus:border-lime-500`}
                                />
                            </form>
                    </div>
                )}
            </div>
            
            <div className="hidden md:flex flex-grow justify-center">
                {/* Desktop Nav Icons can go here */}
            </div>
            
            {user && ![AppView.MESSAGES, AppView.LIVE_ROOM, AppView.LIVE_VIDEO_ROOM].includes(currentView?.view) && (
                <div ref={notificationPanelRef} className="flex items-center gap-2 sm:gap-4 flex-shrink-0 relative">
                    <button onClick={() => setIsMobileSearchOpen(true)} aria-label="Search" className={`p-2.5 rounded-full transition-colors md:hidden border bg-slate-900 hover:bg-slate-800 border-lime-500/30`}>
                        <svg className="w-5 h-5 text-lime-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
                        </svg>
                    </button>
                     <button
                        onClick={handleMicClick}
                        disabled={voiceState === VoiceState.PROCESSING}
                        aria-label="Voice Command"
                        className={`p-2.5 rounded-full transition-colors border bg-slate-900 hover:bg-slate-800 border-lime-500/30`}
                    >
                        <Icon 
                            name="mic" 
                            className={`w-5 h-5 transition-colors ${
                                voiceState === VoiceState.LISTENING 
                                ? 'text-red-500 animate-pulse' 
                                : voiceState === VoiceState.PROCESSING
                                ? 'text-yellow-500'
                                : 'text-lime-500'
                            }`}
                        />
                    </button>
                    <button onClick={handleToggleNotifications} aria-label="Open notifications" className={`p-2.5 rounded-full transition-colors relative border bg-slate-900 hover:bg-slate-800 border-lime-500/30`}>
                        <Icon name="bell" className={`w-5 h-5 text-lime-300`}/>
                        {unreadNotificationCount > 0 && (
                            <span className={`absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white border-2 border-black`}>{unreadNotificationCount}</span>
                        )}
                    </button>

                    
                    {/* --- MOBILE & DESKTOP PROFILE DROPDOWN --- */}
                    <div className="relative" ref={profileMenuRef}>
                        <button onClick={() => setProfileMenuOpen(p => !p)} aria-label="Open profile menu" className="flex items-center gap-2">
                            <img src={user.avatarUrl} alt={user.name} className={`w-9 h-9 rounded-full border-2 transition border-slate-700 hover:border-lime-500`} />
                        </button>
                        {isProfileMenuOpen && (
                            <div className={`absolute top-full right-0 mt-2 w-64 border rounded shadow-2xl z-50 overflow-hidden animate-fade-in-fast bg-black border-lime-500/30`}>
                                <ul>
                                    <li className="p-3">
                                        <button onClick={() => { handleOpenProfile(user.username); setProfileMenuOpen(false); }} className={`w-full text-left p-3 flex items-center gap-3 rounded transition-colors hover:bg-slate-800`}>
                                            <img src={user.avatarUrl} alt={user.name} className="w-10 h-10 rounded-full"/>
                                            <div>
                                                <p className={`font-bold truncate text-lime-300`}>{user.name}</p>
                                                <p className="text-sm text-lime-500">View profile</p>
                                            </div>
                                        </button>
                                    </li>
                                     <li className={`border-t mx-3 my-1 border-lime-500/20`}></li>
                                    {user.role === 'admin' && (
                                        <li>
                                            <a href="/#/adminpannel" target="_blank" rel="noopener noreferrer" className={`w-full text-left p-3 flex items-center gap-3 text-sky-400 transition-colors hover:bg-slate-800`}>
                                                <Icon name="lock-closed" className="w-5 h-5"/> Admin Panel
                                            </a>
                                        </li>
                                    )}
                                    <li>
                                        <button onClick={() => { navigate(AppView.SETTINGS); setProfileMenuOpen(false); }} className={`w-full text-left p-3 flex items-center gap-3 transition-colors hover:bg-slate-800 text-lime-400`}>
                                            <Icon name="settings" className="w-5 h-5 text-lime-500"/> Settings
                                        </button>
                                    </li>
                                    <li>
                                        <button onClick={() => { handleLogout(); setProfileMenuOpen(false); }} className={`w-full text-left p-3 flex items-center gap-3 text-red-500 hover:bg-red-500/10`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>
                                            Logout
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        )}
                    </div>

                    {isNotificationPanelOpen && (
                        <NotificationPanel 
                            notifications={notifications}
                            onClose={() => setNotificationPanelOpen(false)}
                            onNotificationClick={handleNotificationClick}
                        />
                    )}
                </div>
            )}
           </>
        )}
      </header>
      
      <div className="w-full max-w-[1400px] mx-auto flex-grow flex gap-8 px-4 overflow-hidden">
        {user && (
            <Sidebar 
                currentUser={user}
                onNavigate={handleNavigation}
                friendRequestCount={friendRequestCount}
                activeView={currentView?.view || AppView.FEED}
                voiceCoins={user.voiceCoins || 0}
                voiceState={voiceState}
                onMicClick={handleMicClick}
            />
        )}
        <main className="flex-grow overflow-y-auto no-scrollbar py-6">
          {renderView()}
        </main>

        {user && ![AppView.MESSAGES].includes(currentView.view) && (
             <ContactsPanel friends={friends} onOpenConversation={handleOpenConversation} />
        )}

      </div>


      <footer className="flex-shrink-0 z-40">
        {!user ? (
            <VoiceCommandInput
              onSendCommand={handleCommand}
              voiceState={voiceState}
              onMicClick={handleMicClick}
              value={commandInputValue}
              onValueChange={setCommandInputValue}
              placeholder={ttsMessage}
            />
          ) : (
            <div className="hidden md:block">
               <VoiceCommandInput
                onSendCommand={handleCommand}
                voiceState={voiceState}
                onMicClick={handleMicClick}
                value={commandInputValue}
                onValueChange={setCommandInputValue}
                placeholder={ttsMessage}
              />
            </div>
          )}
      </footer>

      {user && (
        <MobileBottomNav 
            onNavigate={handleNavigation}
            friendRequestCount={friendRequestCount}
            activeView={currentView?.view || AppView.FEED}
            voiceState={voiceState}
            onMicClick={handleMicClick}
            onSendCommand={handleCommand}
            commandInputValue={commandInputValue}
            setCommandInputValue={setCommandInputValue}
            ttsMessage={ttsMessage}
        />
      )}

      {isShowingAd && user && (
            <AdModal 
                campaign={campaignForAd}
                onComplete={handleAdComplete}
                onSkip={handleAdSkip}
            />
      )}

      {viewingAd && (
        <CampaignViewerModal post={viewingAd} onClose={() => setViewingAd(null)} />
      )}

      {shareModalPost && (
        <ShareModal 
            post={shareModalPost} 
            onClose={() => setShareModalPost(null)}
            onSetTtsMessage={setTtsMessage}
        />
      )}

      {leadFormPost && user && (
        <LeadFormModal 
            post={leadFormPost}
            currentUser={user}
            onClose={() => setLeadFormPost(null)}
            onSubmit={handleLeadSubmit}
        />
      )}
    </div>
  );
};


export default UserApp;
