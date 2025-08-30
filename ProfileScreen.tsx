
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, Post, FriendshipStatus, ScrollState, AppView } from './types';
import { PostCard } from './components/PostCard';
import Icon from './components/Icon';
import { geminiService } from './services/geminiService';
import { firebaseService } from './services/firebaseService';
import { getTtsPrompt } from './constants';
import ImageCropper from './components/ImageCropper'; // Import the new component
import { useSettings } from './contexts/SettingsContext';
import { t } from './i18n';

interface ProfileScreenProps {
  username: string;
  currentUser: User;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onStartMessage: (recipient: User) => void;
  onEditProfile: () => void;
  onViewPost: (postId: string) => void;
  onOpenProfile: (username: string) => void;
  onReactToPost: (postId: string, emoji: string) => void;
  onBlockUser: (user: User) => void;
  onCurrentUserUpdate: (updatedUser: User) => void;
  onPostCreated: (newPost: Post) => void;
  onSharePost: (post: Post) => void;
  
  onCommandProcessed: () => void;
  scrollState: ScrollState;
  onSetScrollState: (state: ScrollState) => void;
  onNavigate: (view: AppView, props?: any) => void;
  onGoBack: () => void;
  onStartComment: (postId: string) => void;
}

const AboutItem: React.FC<{iconName: React.ComponentProps<typeof Icon>['name'], children: React.ReactNode}> = ({iconName, children}) => (
    <div className="flex items-start gap-3 text-slate-300">
        <Icon name={iconName} className="w-5 h-5 text-slate-400 mt-1 flex-shrink-0"/>
        <p>{children}</p>
    </div>
);


const ProfileScreen: React.FC<ProfileScreenProps> = ({ 
    username, currentUser, onSetTtsMessage, lastCommand, onStartMessage, 
    onEditProfile, onViewPost, onOpenProfile, onReactToPost, onBlockUser, scrollState,
    onCommandProcessed, onSetScrollState, onNavigate, onGoBack,
    onCurrentUserUpdate, onPostCreated,
    onStartComment, onSharePost
}) => {
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPostIndex, setCurrentPostIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { language } = useSettings();
  
  const [cropperState, setCropperState] = useState<{
      isOpen: boolean;
      type: 'avatar' | 'cover' | null;
      imageUrl: string;
      isUploading: boolean;
  }>({ isOpen: false, type: null, imageUrl: '', isUploading: false });

  const [dragState, setDragState] = useState({ isOverAvatar: false, isOverCover: false });

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    const user = await firebaseService.getUserProfile(username);
    if (user) {
      setProfileUser(user);
      const userPosts = await firebaseService.getPostsByUser(user.id);
      setPosts(userPosts);
      const isOwnProfile = user.id === currentUser.id;
      onSetTtsMessage(isOwnProfile ? getTtsPrompt('profile_loaded_own', language) : getTtsPrompt('profile_loaded', language, {name: user.name}));
    } else {
      onSetTtsMessage(`Profile for ${username} not found.`);
    }
    setIsLoading(false);
  }, [username, currentUser.id, onSetTtsMessage, language]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

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
      event.target.value = ''; // Reset input
  };
  
  const handleSaveCrop = async (base64Url: string, caption: string) => {
      if (!profileUser || !cropperState.type) return;

      setCropperState(prev => ({ ...prev, isUploading: true }));

      try {
          let result;
          if (cropperState.type === 'avatar') {
              onSetTtsMessage(getTtsPrompt('profile_picture_update_success', language));
              result = await geminiService.updateProfilePicture(profileUser.id, base64Url, caption);
          } else {
              onSetTtsMessage(getTtsPrompt('cover_photo_update_success', language));
              result = await geminiService.updateCoverPhoto(profileUser.id, base64Url, caption);
          }

          if (result) {
              const { updatedUser, newPost } = result;
              setProfileUser(updatedUser);
              setPosts(currentPosts => [newPost, ...currentPosts]);
              onCurrentUserUpdate(updatedUser);
              onPostCreated(newPost);
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
  
  // --- Drag and Drop Handlers ---
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

  const handleCommand = useCallback(async (command: string) => {
    if (!profileUser) {
        onCommandProcessed();
        return;
    };
    
    try {
        const context = { userNames: [profileUser.name] };
        const intentResponse = await geminiService.processIntent(command, context);
        
        switch (intentResponse.intent) {
          // --- Profile Specific Intents ---
          case 'intent_next_post':
            if(posts.length > 0) {
                isProgrammaticScroll.current = true;
                setCurrentPostIndex(prev => (prev + 1) % posts.length);
                setIsPlaying(true);
            }
            break;
          case 'intent_previous_post':
            if (posts.length > 0) {
                isProgrammaticScroll.current = true;
                setCurrentPostIndex(prev => (prev - 1 + posts.length) % posts.length);
                setIsPlaying(true);
            }
            break;
          case 'intent_play_post':
            if (posts.length > 0) setIsPlaying(true);
            break;
          case 'intent_pause_post':
            setIsPlaying(false);
            break;
          case 'intent_like':
            if(posts.length > 0) {
                onReactToPost(posts[currentPostIndex].id, '👍');
            }
            break;
          case 'intent_share':
            if (posts.length > 0 && posts[currentPostIndex]) {
                onSharePost(posts[currentPostIndex]);
            }
            break;
          case 'intent_comment':
          case 'intent_view_comments':
            handleComment();
            break;
          case 'intent_add_friend':
            if (profileUser.id !== currentUser.id) {
              const result = await geminiService.addFriend(currentUser.id, profileUser.id);
              if (result.success) {
                setProfileUser(u => u ? { ...u, friendshipStatus: FriendshipStatus.REQUEST_SENT } : null);
                onSetTtsMessage(getTtsPrompt('friend_request_sent', language, {name: profileUser.name}));
              } else if(result.reason === 'friends_of_friends'){
                onSetTtsMessage(getTtsPrompt('friend_request_privacy_block', language, {name: profileUser.name}));
              }
            }
            break;
          case 'intent_block_user':
            if (profileUser.id !== currentUser.id) {
              onBlockUser(profileUser);
            }
            break;
          case 'intent_send_message':
             if (profileUser.id !== currentUser.id) {
                onStartMessage(profileUser);
             }
            break;
          case 'intent_edit_profile':
            if (profileUser.id === currentUser.id) {
                onEditProfile();
            }
            break;
            
          // --- Global Intents ---
          case 'intent_go_back':
            onGoBack();
            break;
          case 'intent_reload_page':
            onSetTtsMessage(`Reloading ${profileUser.name}'s profile...`);
            fetchProfile();
            break;
          case 'intent_open_friends_page':
              onNavigate(AppView.FRIENDS);
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
          case 'intent_scroll_down':
              onSetScrollState('down');
              break;
          case 'intent_scroll_up':
              onSetScrollState('up');
              break;
          case 'intent_stop_scroll':
              onSetScrollState('none');
              break;
          default:
              onSetTtsMessage(getTtsPrompt('error_generic', language));
              break;
        }
    } catch (error) {
        console.error("Error processing command in ProfileScreen:", error);
        onSetTtsMessage(getTtsPrompt('error_generic', language));
    } finally {
        onCommandProcessed();
    }
  }, [
      profileUser, posts, currentPostIndex, onSetTtsMessage, onStartMessage, 
      currentUser.id, onEditProfile, onViewPost, onReactToPost, onBlockUser,
      onCommandProcessed, onGoBack, onNavigate, onSetScrollState, fetchProfile, onSharePost, language
  ]);

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

    const baseClasses = "flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50";

    return (
        <>
            {profileUser.friendshipStatus === FriendshipStatus.FRIENDS ? (
                <button disabled className={`${baseClasses} bg-slate-700 text-slate-300`}>{t(language, 'profile.friends')}</button>
            ) : profileUser.friendshipStatus === FriendshipStatus.REQUEST_SENT ? (
                <button disabled className={`${baseClasses} bg-slate-700 text-slate-300`}>{t(language, 'profile.requestSent')}</button>
            ) : (
                <button 
                    onClick={() => handleCommand('add friend')} 
                    className={`${baseClasses} bg-rose-600 text-white hover:bg-rose-500`}
                >
                    <Icon name="add-friend" className="w-5 h-5"/>
                    {t(language, 'profile.addFriend')}
                </button>
            )}
            <button onClick={() => onStartMessage(profileUser)} className={`${baseClasses} bg-sky-600 text-white hover:bg-sky-500`}>
                 <Icon name="message" className="w-5 h-5"/>
                 {t(language, 'profile.message')}
            </button>
        </>
    );
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">{t(language, 'common.loading')}</p></div>;
  }

  if (!profileUser) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">User not found.</p></div>;
  }

  const isOwnProfile = profileUser.id === currentUser.id;

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
                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-900 to-transparent">
                        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4">
                            <div 
                                className="relative group/avatar"
                                onDrop={(e) => isOwnProfile && handleDrop(e, 'avatar')}
                                onDragOver={isOwnProfile ? handleDragOver : undefined}
                                onDragEnter={(e) => isOwnProfile && handleDragEnter(e, 'avatar')}
                                onDragLeave={(e) => isOwnProfile && handleDragLeave(e, 'avatar')}
                            >
                               <img src={profileUser.avatarUrl} alt={profileUser.name} className="w-28 h-28 sm:w-40 sm:h-40 rounded-full border-4 border-slate-900 object-cover" />
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
                            <div className="flex-grow text-center sm:text-left mb-2">
                                <h2 className="text-3xl font-bold text-slate-100">{profileUser.name}</h2>
                                <p className="text-slate-400 mt-1">{profileUser.bio}</p>
                            </div>
                             <div className="flex justify-center sm:justify-end gap-3 mb-2">
                                {isOwnProfile ? (
                                    <button onClick={onEditProfile} className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors bg-slate-600 text-white hover:bg-slate-500">
                                        <Icon name="edit" className="w-5 h-5"/>
                                        {t(language, 'profile.editProfile')}
                                    </button>
                                ) : renderActionButtons()}
                            </div>
                        </div>
                    </div>
                </header>
                
                <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-6">
                    <aside className="md:col-span-5 space-y-6">
                        <div className="bg-slate-800 p-4 rounded-lg">
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
                    </aside>

                    <main id="post-list-container" className="md:col-span-7 flex flex-col gap-8">
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
                                />
                            </div>
                        )) : (
                          <div className="bg-slate-800 p-8 rounded-lg text-center text-slate-400">
                              <p>{t(language, 'profile.noPosts', { name: profileUser.name })}</p>
                          </div>
                        )}
                    </main>
                </div>
            </div>
        </div>
        
        {/* Photo Cropper Modal */}
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

export default ProfileScreen;
