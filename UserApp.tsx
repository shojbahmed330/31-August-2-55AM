
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppView, User, VoiceState, Post, Comment, ScrollState, Notification, Campaign, Group, Story } from './types';
import AuthScreen from './components/AuthScreen';
import FeedScreen from './components/FeedScreen';
import ExploreScreen from './components/ExploreScreen';
import ReelsScreen from './components/ReelsScreen';
import CreatePostScreen from './components/CreatePostScreen';
import CreateReelScreen from './components/CreateReelScreen';
import CreateCommentScreen from './components/CreateCommentScreen';
// Fix: Changed default import to named import for ProfileScreen.
import { ProfileScreen } from './components/ProfileScreen';
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
import ImageModal from './components/ImageModal';
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
  const [friendRequests, setFriendRequests] = useState<User[]>([]);
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
  const [viewerPost, setViewerPost] = useState<Post | null>(null);
  const [isLoadingViewerPost, setIsLoadingViewerPost] = useState(false);
  const { language } = useSettings();
  
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null); // To hold the active speech recognition instance
  const viewerPostUnsubscribe = useRef<(() => void) | null>(null);
  const currentView = viewStack[viewStack.length - 1];
  const unreadNotificationCount = notifications.filter(n => !n.read).length;

  // Refined friend request count logic. Filters out requests from users who are already friends to prevent inconsistencies.
  const friendIds = useMemo(() => new Set(friends.map(f => f.id)), [friends]);
  const friendRequestCount = useMemo(() => {
      return friendRequests.filter(r => r && !friendIds.has(r.id)).length;
  }, [friendRequests, friendIds]);


  useEffect(() => {
    const hash = window.location.hash;
    const postMatch = hash.match(/^#\/post\/([\w-]+)/);
    if (postMatch && postMatch[1]) {
        setInitialDeepLink({ view: AppView.POST_DETAILS, props: { postId: postMatch[1] } });
    }
  }, []);

  const handleClosePhotoViewer = useCallback(() => {
    if (viewerPostUnsubscribe.current) {
        viewerPostUnsubscribe.current();
        viewerPostUnsubscribe.current = null;
    }
    setViewerPost(null);
    setIsLoadingViewerPost(false);
  }, []);

  const handleLogout = useCallback(() => {
    firebaseService.signOutUser();
    setUser(null);
    setPosts([]);
    setFriends([]);
    setFriendRequests([]);
    setGroups([]);
    setNotifications([]);
    setViewStack([{ view: AppView.AUTH }]);
  }, []);

  useEffect(() => {
    let unsubscribePosts: () => void = () => {};
    let unsubscribeReelsPosts: () => void = () => {};
    let unsubscribeFriends: () => void = () => {};
    let unsubscribeFriendRequests: () => void = () => {};
    let unsubscribeNotifications: () => void = () => {};
    let unsubscribeUserDoc: () => void = () => {};
    let unsubscribeAcceptedRequests: () => void = () => {};

    const unsubscribeAuth = firebaseService.onAuthStateChanged(async (userAuth) => {
        // Clear all previous listeners when auth state changes
        unsubscribePosts();
        unsubscribeReelsPosts();
        unsubscribeFriends();
        unsubscribeFriendRequests();
        unsubscribeNotifications();
        unsubscribeUserDoc();
        unsubscribeAcceptedRequests();

        if (userAuth) {
            let isFirstLoad = true;
            unsubscribeUserDoc = firebaseService.listenToCurrentUser(userAuth.id, async (userProfile) => {
                if (userProfile && !userProfile.isDeactivated && !userProfile.isBanned) {
                    setUser(userProfile);

                    if (isFirstLoad) {
                         if (!initialDeepLink) {
                            setTtsMessage(getTtsPrompt('login_success', language, { name: userProfile.name }));
                        }
                        if (initialDeepLink) {
                            setViewStack([initialDeepLink]);
                            setInitialDeepLink(null);
                        } else if (currentView?.view === AppView.AUTH) {
                            setViewStack([{ view: AppView.FEED }]);
                        }
                        isFirstLoad = false;
                    }
                } else {
                    if (userProfile?.isDeactivated) console.log(`User ${userAuth.id} is deactivated. Signing out.`);
                    if (userProfile?.isBanned) console.log(`User ${userAuth.id} is banned. Signing out.`);
                    handleLogout();
                }
                setIsAuthLoading(false);
            });

            // Set up other real-time listeners that depend on the user's existence
            setIsLoadingFeed(true);
            setIsLoadingReels(true);
            unsubscribePosts = firebaseService.listenToFeedPosts(userAuth.id, (feedPosts) => {
                setPosts(feedPosts);
                setIsLoadingFeed(false);
            });
            unsubscribeReelsPosts = firebaseService.listenToReelsPosts((newReelsPosts) => {
                setReelsPosts(newReelsPosts);
                setIsLoadingReels(false);
            });
            unsubscribeFriends = firebaseService.listenToFriends(userAuth.id, (friendsList) => {
                setFriends(friendsList);
            });
            unsubscribeFriendRequests = firebaseService.listenToFriendRequests(userAuth.id, (requests) => {
                setFriendRequests(requests);
            });
            unsubscribeNotifications = firebaseService.listenToNotifications(userAuth.id, (newNotifications) => {
                setNotifications(newNotifications);
            });
            
            // New listener for when someone accepts OUR friend request
            unsubscribeAcceptedRequests = firebaseService.listenToAcceptedFriendRequests(userAuth.id, (acceptedRequests) => {
                if (acceptedRequests.length > 0) {
                    console.log("Processing accepted friend requests:", acceptedRequests);
                    acceptedRequests.forEach(request => {
                        // Finalize the friendship: add them to our friend list and delete the request
                        firebaseService.finalizeFriendship(userAuth.id, request.to);
                    });
                }
            });

        } else {
            // User logged out
            setUser(null);
            setPosts([]);
            setReelsPosts([]);
            setFriends([]);
            setFriendRequests([]);
            setNotifications([]);
            setViewStack([{ view: AppView.AUTH }]);
            setIsAuthLoading(false);
        }
    });

    return () => {
        unsubscribeAuth();
        unsubscribePosts();
        unsubscribeReelsPosts();
        unsubscribeFriends();
        unsubscribeFriendRequests();
        unsubscribeNotifications();
        unsubscribeUserDoc();
        unsubscribeAcceptedRequests();
        handleClosePhotoViewer();
    };
  }, [initialDeepLink, language, handleClosePhotoViewer, handleLogout]);

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
  
  const handleStartMessage = async (recipient: User) => {
    if (!user) return;
    await firebaseService.ensureChatDocumentExists(user, recipient);
    navigate(AppView.MESSAGES, { recipient, ttsMessage: getTtsPrompt('message_screen_loaded', language, { name: recipient.name }) });
  };

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
        case 'friend_request_approved':
            if (notification.user?.username) {
                setTtsMessage(`${notification.user.name} accepted your friend request.`);
                navigate(AppView.PROFILE, { username: notification.user.username });
            }
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
    if (!user || !post.isSponsored || !post.campaignId) return;

    await firebaseService.trackAdClick(post.campaignId);
    
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
            await handleStartMessage(sponsorUser);
        } else {
            setTtsMessage(`Could not find sponsor ${post.sponsorName}.`);
        }
    } else if (post.sponsorId) {
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
    if (!success) {
      setTtsMessage(`Could not react. You may be offline.`);
    }
  };

  const handleReactToComment = async (postId: string, commentId: string, emoji: string) => {
    if (!user) return;
    await firebaseService.reactToComment(postId, commentId, user.id, emoji);
    // Real-time listener will update the UI.
  };

  const handlePostComment = async (postId: string, text: string, parentId: string | null = null) => {
    if (!user || !text.trim()) return;
    if (user.commentingSuspendedUntil && new Date(user.commentingSuspendedUntil) > new Date()) {
        setTtsMessage(getTtsPrompt('comment_suspended', language));
        return;
    }
    await firebaseService.createComment(user, postId, { text, parentId });
    // Listener will add the new comment to the UI.
  };

  const handleEditComment = async (postId: string, commentId: string, newText: string) => {
    if (!user) return;
    await firebaseService.editComment(postId, commentId, newText);
  };
  
  const handleDeleteComment = async (postId: string, commentId: string) => {
      if (!user) return;
      await firebaseService.deleteComment(postId, commentId);
  };

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

  const handleOpenPhotoViewer = (post: Post) => {
    if (!post.imageUrl && !post.newPhotoUrl) return;

    if (viewerPostUnsubscribe.current) {
        viewerPostUnsubscribe.current();
        viewerPostUnsubscribe.current = null;
    }
    
    // Set the post immediately so the modal can open with the existing, potentially stale, data.
    // This prevents passing null and causing a crash.
    setViewerPost(post);
    setIsLoadingViewerPost(false); // We are not in a loading state initially because we have data to show.

    // For non-ad posts that exist in Firestore, set up a listener to get real-time updates.
    if (!post.isSponsored && !post.id.startsWith('ad_')) {
        const unsubscribe = firebaseService.listenToPost(post.id, (updatedPost) => {
            if (updatedPost) {
                // A live update came in. Update the state to reflect it.
                setViewerPost(updatedPost);
            } else {
                // The post was deleted from the backend while the user was viewing it.
                // FIX: Corrected function call from onSetTtsMessage to setTtsMessage
                setTtsMessage("This post is no longer available.");
                handleClosePhotoViewer(); // This will close the modal gracefully.
            }
        });
        // Store the unsubscribe function to be called when the modal is closed.
        viewerPostUnsubscribe.current = unsubscribe;
    }
  };

  const handleOpenProfile = (username: string) => navigate(AppView.PROFILE, { username });
  const handleViewPost = (postId: string) => navigate(AppView.POST_DETAILS, { postId });
  const handleEditProfile = () => navigate(AppView.SETTINGS, { ttsMessage: getTtsPrompt('settings_opened', language) });
  
  const handleStartComment = (postId: string, commentToReplyTo?: Comment) => {
    if (user?.commentingSuspendedUntil && new Date(user.commentingSuspendedUntil) > new Date()) {
        setTtsMessage(getTtsPrompt('comment_suspended', language));
        return;
    }
    handleClosePhotoViewer(); // Close photo viewer if open before navigating
    navigate(AppView.CREATE_COMMENT, { postId, commentToReplyTo });
  };

  const handleOpenConversation = async (peer: User) => {
    if (!user) return;
    // Ensure the chat document exists before navigating to the message screen.
    // This prevents permission errors when trying to listen to messages of a non-existent chat.
    await firebaseService.ensureChatDocumentExists(user, peer);
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
      onOpenPhotoViewer: handleOpenPhotoViewer,
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
        return <ExploreScreen {...commonScreen