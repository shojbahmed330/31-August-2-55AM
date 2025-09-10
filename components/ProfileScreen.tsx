
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, Post, FriendshipStatus, ScrollState, AppView, Comment } from '../types';
import { PostCard } from './PostCard';
import Icon from './Icon';
import { geminiService } from '../services/geminiService';
import { firebaseService } from '../services/firebaseService';
import { getTtsPrompt } from '../constants';
import ImageCropper from './ImageCropper';
import { useSettings } from '../contexts/SettingsContext';
import { t } from '../i18n';
import UserCard from './UserCard';


interface ProfileScreenProps {
  username: string;
  currentUser: User;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onOpenConversation: (recipient: User) => void;
  onEditProfile: () => void;
  onViewPost: (postId: string) => void;
  onOpenProfile: (username: string) => void;
  onReactToPost: (postId: string, emoji: string) => void;
  onBlockUser: (user: User) => void;
  onCurrentUserUpdate: (updatedUser: User) => void;
  onPostCreated: (newPost: Post) => void;
  onSharePost: (post: Post) => void;
  onOpenPhotoViewer: (post: Post) => void;
  
  onCommandProcessed: () => void;
  scrollState: ScrollState;
  onSetScrollState: (state: ScrollState) => void;
  onNavigate: (view: AppView, props?: any) => void;
  onGoBack: () => void;
  onStartComment: (postId: string, commentToReplyTo?: Comment) => void;
}

const AboutItem: React.FC<{iconName: React.ComponentProps<typeof Icon>['name'], children: React.ReactNode}> = ({iconName, children}) => (
    <div className="flex items-start gap-3 text-slate-300">
        <Icon name={iconName} className="w-5 h-5 text-slate-400 mt-1 flex-shrink-0"/>
        <p>{children}</p>
    </div>
);


export const ProfileScreen: React.FC<ProfileScreenProps> = ({ 
    username, currentUser, onSetTtsMessage, lastCommand, onOpenConversation, 
    onEditProfile, onViewPost, onOpenProfile, onReactToPost, onBlockUser, scrollState,
    onCommandProcessed, onSetScrollState, onNavigate, onGoBack,
    onCurrentUserUpdate, onPostCreated,
    onStartComment, onSharePost, onOpenPhotoViewer
}) => {
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [commonFriends, setCommonFriends] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [friendshipStatus, setFriendshipStatus] = useState<FriendshipStatus>(FriendshipStatus.NOT_FRIENDS);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [activeTab, setActiveTab] = useState<'posts' | 'about' | 'friends'>('posts');
  
  const [currentPostIndex, setCurrentPostIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const isInitialLoadRef = useRef(true);
  const { language } = useSettings();
  
  const [cropperState, setCropperState] = useState<{
      isOpen: boolean;
      type: 'avatar' | 'cover' | null;
      imageUrl: string;
      isUploading: boolean;
  }>({ isOpen: false, type: null, imageUrl: '', isUploading: false });

  const [dragState, setDragState] = useState({ isOverAvatar: false, isOverCover: false });

  useEffect(() => {
    setIsLoading(true);
    isInitialLoadRef.current = true;
    
    const unsubscribe = firebaseService.listenToUserProfile(username, async (user) => {
      if (user) {
        setProfileUser(user);
        
        const userPosts = await firebaseService.getPostsByUser(user.id);
        setPosts(userPosts);
        
        if (user.friendIds && user.friendIds.length > 0) {
            const friends = await firebaseService.getUsersByIds(user.friendIds);
            setFriendsList(friends);
        } else {
            setFriendsList([]);
        }

        if (user.id !== currentUser.id) {
            const common = await geminiService.getCommonFriends(currentUser.id, user.id);
            setCommonFriends(common);
        } else {
            setCommonFriends([]); 
        }

        if (isInitialLoadRef.current) {
          const isOwnProfile = user.id === currentUser.id;
          onSetTtsMessage(isOwnProfile ? getTtsPrompt('profile_loaded_own', language) : getTtsPrompt('profile_loaded', language, {name: user.name}));
          isInitialLoadRef.current = false;
        }

      } else {
        onSetTtsMessage(`Profile for ${username} not found.`);
      }
      setIsLoading(false);
    });
    
    return () => unsubscribe();
  }, [username, currentUser.id, onSetTtsMessage, language]);

  useEffect(() => {
    if (!profileUser || !currentUser || profileUser.id === currentUser.id) {
        setIsLoadingStatus(false);
        return;
    }

    const checkStatus = async () => {
        setIsLoadingStatus(true);
        try {
            const status = await firebaseService.checkFriendshipStatus(currentUser.id, profileUser.id);
            setFriendshipStatus(status);
        } catch (error) {
            console.error("Failed to check friendship status:", error);
            setFriendshipStatus(FriendshipStatus.NOT_FRIENDS);
        } finally {
            setIsLoadingStatus(false);
        }
    };

    checkStatus();
  }, [profileUser, currentUser]);

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
  
  const handleComment = () => {
     if (posts.length > 0) {
        onViewPost(posts[currentPostIndex].id);
     }
  }

  const openCropperModal = (file: File, type: 'avatar' | 'cover') => {
      if (file && file.type.startsWith('image/')) {
          setCropperState({
              isOpen: true,
              type,
              imageUrl: URL.createObjectURL(file),
              isUploading: false,
          });
      }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
      const file = event.target.files?.[0];
      if (file) {
          openCropperModal(file, type);
      }
      event.target.value = ''; 
  };
  
  const handleSaveCrop = async (base64Url: string, caption?: string, captionStyle?: Post['captionStyle']) => {
      if (!profileUser || !cropperState.type) return;

      setCropperState(prev => ({ ...prev, isUploading: true }));

      try {
          let result;
          if (cropperState.type === 'avatar') {
              onSetTtsMessage(getTtsPrompt('profile_picture_update_success', language));
              result = await geminiService.updateProfilePicture(profileUser.id, base64Url, caption, captionStyle);
          } else {
              onSetTtsMessage(getTtsPrompt('cover_photo_update_success', language));
              result = await geminiService.updateCoverPhoto(profileUser.id, base64Url, caption, captionStyle);
          }

          if (result) {
              onCurrentUserUpdate(result.updatedUser);
              onPostCreated(result.newPost);
              onSetTtsMessage(cropperState.type === 'avatar' ? getTtsPrompt('profile_picture_update_success', language) : getTtsPrompt('cover_photo_update_success', language));
          } else {
              throw new Error("Update failed in service.");
          }
      } catch (error) {
          console.error(`Failed to update ${cropperState.type}:`, error);
          onSetTtsMessage(getTtsPrompt('photo_update_fail', language));
      } finally {
          closeCropperModal();
      }
  };

  const closeCropperModal = () => {
      if (cropperState.imageUrl) {
          URL.revokeObjectURL(cropperState.imageUrl);
      }
      setCropperState({ isOpen: false, type: null, imageUrl: '', isUploading: false });
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLElement>, type: 'avatar' | 'cover') => {
      e.preventDefault();
      setDragState(prev => ({ ...prev, [type === 'avatar' ? 'isOverAvatar' : 'isOverCover']: true }));
  };

  const handleDragLeave = (e: React.DragEvent<HTMLElement>, type: 'avatar' | 'cover') => {
      e.preventDefault();
      setDragState(prev => ({ ...prev, [type === 'avatar' ? 'isOverAvatar' : 'isOverCover']: false }));
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>, type: 'avatar' | 'cover') => {
      e.preventDefault();
      setDragState({ isOverAvatar: false, isOverCover: false });
      const file = e.dataTransfer.files?.[0];
      if (file) {
          openCropperModal(file, type);
      }
  };

  const handleAddFriendAction = useCallback(async () => {
    if (!profileUser || isLoadingStatus) return;
    setIsLoadingStatus(true);
    const result = await geminiService.addFriend(currentUser.id, profileUser.id);
    if (result.success) {
        setFriendshipStatus(FriendshipStatus.REQUEST_SENT);
        onSetTtsMessage(getTtsPrompt('friend_request_sent', language, { name: profileUser.name }));
    } else if (result.reason === 'friends_of_friends') {
        onSetTtsMessage(getTtsPrompt('friend_request_privacy_block', language, { name: profileUser.name }));
    } else {
        onSetTtsMessage("Failed to send friend request. Please try again later.");
    }
    setIsLoadingStatus(false);
  }, [profileUser, currentUser.id, onSetTtsMessage, language, isLoadingStatus]);

  const handleRespondToRequest = useCallback(async (response: 'accept' | 'decline') => {
      if (!profileUser || isLoadingStatus) return;
      setIsLoadingStatus(true);
      if (response === 'accept') {
          await geminiService.acceptFriendRequest(currentUser.id, profileUser.id);
          setFriendshipStatus(FriendshipStatus.FRIENDS);
          onSetTtsMessage(getTtsPrompt('friend_request_accepted', language, { name: profileUser.name }));
      } else {
          await geminiService.declineFriendRequest(currentUser.id, profileUser.id);
          setFriendshipStatus(FriendshipStatus.NOT_FRIENDS);
          onSetTtsMessage(getTtsPrompt('friend_request_declined', language, { name: profileUser.name }));
      }
      setIsLoadingStatus(false);
  }, [profileUser, currentUser.id, onSetTtsMessage, language, isLoadingStatus]);

  const handleCommand = useCallback(async (command: string) => {
    if (!profileUser) {
        onCommandProcessed();
        return;
    };
    
    try {
        const context = { userNames: [profileUser.name] };
        const intentResponse = await geminiService.processIntent(command, context);
        
        switch (intentResponse.intent) {
          case 'intent_add_friend':
            if (profileUser.id !== currentUser.id && friendshipStatus === FriendshipStatus.NOT_FRIENDS) {
                handleAddFriendAction();
            }
            break;
          case 'intent_accept_request':
              if (friendshipStatus === FriendshipStatus.PENDING_APPROVAL) {
                  handleRespondToRequest('accept');
              }
              break;
        }
    } catch (error) {
        console.error("Error processing command in ProfileScreen:", error);
        onSetTtsMessage(getTtsPrompt('error_generic', language));
    } finally {
        onCommandProcessed();
    }
  }, [profileUser, currentUser.id, onCommandProcessed, onSetTtsMessage, language, handleAddFriendAction, friendshipStatus, handleRespondToRequest]);

  useEffect(() => {
    if (lastCommand) {
      handleCommand(lastCommand);
    }
  }, [lastCommand, handleCommand]);


  useEffect(() => {
    if (!isProgrammaticScroll.current || posts.length === 0) return;

    const postListContainer = scrollContainerRef.current?.querySelector('#post-list-container');
    if (postListContainer && postListContainer.children.length > currentPostIndex) {
        const cardElement = postListContainer.children[currentPostIndex] as HTMLElement;
        if (cardElement) {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const timeout = setTimeout(() => {
                isProgrammaticScroll.current = false;
            }, 1000);
            return () => clearTimeout(timeout);
        }
    }
  }, [currentPostIndex, posts]);

  const renderActionButtons = () => {
    if (!profileUser || currentUser.id === profileUser.id) return null;
    if (isLoadingStatus) {
        return <div className="h-10 w-56 bg-slate-700 animate-pulse rounded-lg" />;
    }

    const baseClasses = "flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50";

    switch (friendshipStatus) {
        case FriendshipStatus.FRIENDS:
            return <button disabled className={`${baseClasses} bg-slate-700 text-slate-300`}>{t(language, 'profile.friends')}</button>;
        case FriendshipStatus.REQUEST_SENT:
            return <button disabled className={`${baseClasses} bg-slate-700 text-slate-300`}>{t(language, 'profile.requestSent')}</button>;
        case FriendshipStatus.PENDING_APPROVAL:
            return (
                <div className="flex items-center gap-2">
                    <button onClick={() => handleRespondToRequest('decline')} className={`${baseClasses} bg-slate-600 text-white hover:bg-slate-500`}>Decline</button>
                    <button onClick={() => handleRespondToRequest('accept')} className={`${baseClasses} bg-lime-600 text-black hover:bg-lime-500`}><Icon name="add-friend" className="w-5 h-5"/> Respond to Request</button>
                </div>
            );
        default:
            return <button onClick={handleAddFriendAction} className={`${baseClasses} bg-rose-600 text-white hover:bg-rose-500`}><Icon name="add-friend" className="w-5 h-5"/> {t(language, 'profile.addFriend')}</button>;
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">{t(language, 'common.loading')}</p></div>;
  }

  if (!profileUser) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">User not found.</p></div>;
  }

  const isOwnProfile = profileUser.id === currentUser.id;
  
  const TabButton: React.FC<{tabId: 'posts' | 'about' | 'friends'; label: string; count?: number}> = ({ tabId, label, count }) => (
    <button 
        onClick={() => setActiveTab(tabId)}
        className={`px-4 py-3 font-semibold text-lg border-b-4 transition-colors ${activeTab === tabId ? 'border-lime-500 text-lime-300' : 'border-transparent text-lime-500 hover:text-lime-300'}`}
    >
        {label} {count !== undefined && <span className={`ml-1 text-sm text-lime-400/80`}>{count}</span>}
    </button>
  );

  return (
    <>
        <div ref={scrollContainerRef} className="h-full w-full overflow-y-auto bg-slate-900">
            <div className="max-w-4xl mx-auto">
                <header 
                    className="relative group/cover"
                    onDrop={(e) => isOwnProfile && handleDrop(e, 'cover')}
                    onDragOver={isOwnProfile ? handleDragOver : undefined}
                    onDragEnter={(e) => isOwnProfile && handleDragEnter(e, 'cover')}
                    onDragLeave={(e) => isOwnProfile && handleDragLeave(e, 'cover')}
                >
                    <div className="w-full h-48 sm:h-72 bg-slate-700">
                        <img src={profileUser.coverPhotoUrl} alt={`${profileUser.name}'s cover photo`} className="w-full h-full object-cover" />
                    </div>
                     {isOwnProfile && (
                        <>
                            <input type="file" accept="image/*" ref={coverInputRef} onChange={(e) => handleFileSelect(e, 'cover')} className="hidden" />
                            <button 
                                onClick={() => coverInputRef.current?.click()}
                                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white font-semibold py-2 px-4 rounded-lg transition-opacity opacity-0 group-hover/cover:opacity-100 flex items-center gap-2"
                            >
                                <Icon name="edit" className="w-5 h-5"/> {t(language, 'profile.changeCover')}
                            </button>
                        </>
                    )}
                    {dragState.isOverCover && (
                        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center border-4 border-dashed border-sky-400 rounded-lg pointer-events-none">
                            <Icon name="edit" className="w-16 h-16 text-sky-400" />
                            <p className="mt-2 text-xl font-bold text-white">{t(language, 'profile.dropToUpdateCover')}</p>
                        </div>
                    )}
                    <div className="absolute -bottom-16 sm:-bottom-20 left-1/2 -translate-x-1/2 sm:left-8 sm:translate-x-0 w-full sm:w-auto">
                        <div 
                            className="relative group/avatar w-32 h-32 sm:w-40 sm:h-40 mx-auto sm:mx-0"
                            onDrop={(e) => isOwnProfile && handleDrop(e, 'avatar')}
                            onDragOver={isOwnProfile ? handleDragOver : undefined}
                            onDragEnter={(e) => isOwnProfile && handleDragEnter(e, 'avatar')}
                            onDragLeave={(e) => isOwnProfile && handleDragLeave(e, 'avatar')}
                        >
                           <img src={profileUser.avatarUrl} alt={profileUser.name} className="w-full h-full rounded-full border-4 border-slate-900 object-cover" />
                           {isOwnProfile && (
                                <>
                                    <input type="file" accept="image/*" ref={avatarInputRef} onChange={(e) => handleFileSelect(e, 'avatar')} className="hidden" />
                                    <button 
                                        onClick={() => avatarInputRef.current?.click()}
                                        className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity"
                                        aria-label={t(language, 'profile.changeAvatar')}
                                    >
                                        <Icon name="edit" className="w-10 h-10"/>
                                    </button>
                                </>
                           )}
                           {dragState.isOverAvatar && (
                                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center border-4 border-dashed border-sky-400 rounded-full pointer-events-none">
                                    <p className="text-sm font-bold text-white text-center">{t(language, 'profile.dropToUpdateAvatar')}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </header>
                
                <div className="pt-20 sm:pt-4 px-4 pb-4">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="sm:pl-48 text-center sm:text-left">
                            <h2 className="text-3xl font-bold text-slate-100">{profileUser.name}</h2>
                            <p className="text-slate-400 mt-1">{profileUser.bio}</p>
                            {!isOwnProfile && commonFriends.length > 0 && (
                                <div className="mt-3 flex items-center gap-2 justify-center sm:justify-start">
                                    <div className="flex -space-x-2">
                                        {commonFriends.slice(0, 3).map(friend => (
                                            <img key={friend.id} src={friend.avatarUrl} alt={friend.name} className="w-6 h-6 rounded-full border-2 border-slate-900" />
                                        ))}
                                    </div>
                                    <p className="text-sm text-slate-400">
                                        <span className="font-semibold text-slate-300">{commonFriends.length}</span> common friend{commonFriends.length > 1 ? 's' : ''}
                                    </p>
                                </div>
                            )}
                        </div>
                         <div className="flex justify-center sm:justify-end gap-3">
                            {isOwnProfile ? (
                                <button onClick={onEditProfile} className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors bg-slate-600 text-white hover:bg-slate-500">
                                    <Icon name="edit" className="w-5 h-5"/>
                                    {t(language, 'profile.editProfile')}
                                </button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    {renderActionButtons()}
                                     <button onClick={() => onOpenConversation(profileUser)} className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors bg-sky-600 text-white hover:bg-sky-500">
                                         <Icon name="message" className="w-5 h-5"/>
                                         {t(language, 'profile.message')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="border-t border-lime-500/20 px-4">
                    <TabButton tabId="posts" label="Posts" count={posts.length} />
                    <TabButton tabId="about" label="About" />
                    <TabButton tabId="friends" label="Friends" count={friendsList.length} />
                </div>
                
                <div className="p-4">
                    {activeTab === 'posts' && (
                        <div id="post-list-container" className="max-w-lg mx-auto flex flex-col gap-8">
                             {posts.length > 0 ? posts.map((post, index) => (
                                <div key={post.id} className="w-full snap-center">
                                    <PostCard 
                                        post={post} 
                                        currentUser={currentUser}
                                        isActive={index === currentPostIndex}
                                        isPlaying={isPlaying && index === currentPostIndex}
                                        onPlayPause={() => {
                                            setIsPlaying(p => index === currentPostIndex ? !p : true);
                                            if(index !== currentPostIndex) {
                                                isProgrammaticScroll.current = true;
                                                setCurrentPostIndex(index);
                                            }
                                        }}
                                        onReact={onReactToPost}
                                        onViewPost={onViewPost}
                                        onAuthorClick={onOpenProfile}
                                        onStartComment={onStartComment}
                                        onSharePost={onSharePost}
                                        onOpenPhotoViewer={onOpenPhotoViewer}
                                    />
                                </div>
                            )) : (
                              <div className="bg-slate-800 p-8 rounded-lg text-center text-slate-400">
                                  <p>{t(language, 'profile.noPosts', { name: profileUser.name })}</p>
                              </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'about' && (
                        <div className="max-w-lg mx-auto bg-slate-800 p-4 rounded-lg">
                            <h3 className="font-bold text-xl text-slate-100 mb-4">{t(language, 'profile.about')}</h3>
                            <div className="space-y-3">
                                {isOwnProfile && profileUser.voiceCoins !== undefined && (
                                    <AboutItem iconName="coin">
                                        {t(language, 'profile.voiceCoins', { count: profileUser.voiceCoins })}
                                    </AboutItem>
                                )}
                                {profileUser.work && <AboutItem iconName="briefcase">{t(language, 'profile.worksAt')} <strong>{profileUser.work}</strong></AboutItem>}
                                {profileUser.education && <AboutItem iconName="academic-cap">{t(language, 'profile.studiedAt')} <strong>{profileUser.education}</strong></AboutItem>}
                                {profileUser.currentCity && <AboutItem iconName="map-pin">{t(language, 'profile.livesIn')} <strong>{profileUser.currentCity}</strong></AboutItem>}
                                {profileUser.hometown && <AboutItem iconName="home">{t(language, 'profile.from')} <strong>{profileUser.hometown}</strong></AboutItem>}
                                {profileUser.relationshipStatus && profileUser.relationshipStatus !== 'Prefer not to say' && <AboutItem iconName="like"><strong>{profileUser.relationshipStatus}</strong></AboutItem>}
                            </div>
                        </div>
                    )}
                    {activeTab === 'friends' && (
                        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {friendsList.length > 0 ? friendsList.map(friend => (
                                <div key={friend.id} className="bg-slate-800 p-4 rounded-lg flex flex-col items-center text-center">
                                    <img onClick={() => onOpenProfile(friend.username)} src={friend.avatarUrl} alt={friend.name} className="w-24 h-24 rounded-full cursor-pointer"/>
                                    <p onClick={() => onOpenProfile(friend.username)} className="font-bold text-slate-100 mt-2 cursor-pointer hover:underline">{friend.name}</p>
                                </div>
                            )) : (
                                <p className="col-span-full text-center text-slate-400 py-8">
                                    {profileUser.name} has no friends yet.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
        
        {cropperState.isOpen && (
             <ImageCropper
                imageUrl={cropperState.imageUrl}
                aspectRatio={cropperState.type === 'avatar' ? 1 : 16 / 9}
                onSave={handleSaveCrop}
                onCancel={closeCropperModal}
                isUploading={cropperState.isUploading}
            />
        )}
    </>
  );
};
