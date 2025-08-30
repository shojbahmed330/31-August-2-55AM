
import React, { useState, useEffect, useRef } from 'react';
import { AppView, LiveAudioRoom, User } from '../types';
import { geminiService } from '../services/geminiService';
import Icon from './Icon';
import { AGORA_APP_ID } from '../constants';
import type { IAgoraRTCClient, IAgoraRTCRemoteUser, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';

// Let TypeScript know about the AgoraRTC global variable from the script tag
declare const AgoraRTC: any;

interface LiveRoomScreenProps {
  currentUser: User;
  roomId: string;
  onNavigate: (view: AppView, props?: any) => void;
  onGoBack: () => void;
  onSetTtsMessage: (message: string) => void;
}

const Avatar: React.FC<{ user: User; isHost?: boolean; isSpeaking?: boolean; children?: React.ReactNode }> = ({ user, isHost, isSpeaking, children }) => (
    <div className="relative flex flex-col items-center gap-2 text-center w-24">
        <div className="relative">
            <img 
                src={user.avatarUrl}
                alt={user.name}
                className={`w-20 h-20 rounded-full border-4 transition-all duration-300 ${isSpeaking ? 'border-green-400 ring-4 ring-green-500/50' : 'border-slate-600'}`}
            />
            {isHost && <div className="absolute -bottom-2 -right-1 text-2xl">👑</div>}
        </div>
        <p className="font-semibold text-slate-200 truncate w-full">{user.name}</p>
        {children}
    </div>
);


const LiveRoomScreen: React.FC<LiveRoomScreenProps> = ({ currentUser, roomId, onNavigate, onGoBack, onSetTtsMessage }) => {
    const [room, setRoom] = useState<LiveAudioRoom | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

    const agoraClient = useRef<IAgoraRTCClient | null>(null);
    const localAudioTrack = useRef<IMicrophoneAudioTrack | null>(null);
    const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
    const [isMuted, setIsMuted] = useState(false);
    
    // This effect handles the entire Agora lifecycle
    useEffect(() => {
        if (!AGORA_APP_ID) {
            onSetTtsMessage("Agora App ID is not configured. Real-time audio will not work.");
            console.error("Agora App ID is not configured in constants.ts");
            onGoBack();
            return;
        }

        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        agoraClient.current = client;
        let isSpeaker = false;

        const handleUserPublished = async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
            await client.subscribe(user, mediaType);
            if (mediaType === 'audio') {
                user.audioTrack?.play();
            }
            setRemoteUsers(Array.from(client.remoteUsers));
        };

        const handleUserUnpublished = (user: IAgoraRTCRemoteUser) => {
            setRemoteUsers(Array.from(client.remoteUsers));
        };

        const handleUserLeft = (user: IAgoraRTCRemoteUser) => {
             setRemoteUsers(prevUsers => prevUsers.filter(u => u.uid !== user.uid));
        };

        const handleVolumeIndicator = (volumes: any[]) => {
            let maxVolume = 0;
            let speakerUid: string | null = null;
            volumes.forEach(volume => {
                if (volume.level > maxVolume) {
                    maxVolume = volume.level;
                    speakerUid = volume.uid.toString();
                }
            });
            setActiveSpeakerId(speakerUid);
        };
        
        const setupAgora = async () => {
            client.on('user-published', handleUserPublished);
            client.on('user-unpublished', handleUserUnpublished);
            client.on('user-left', handleUserLeft);
            client.enableAudioVolumeIndicator();
            client.on('volume-indicator', handleVolumeIndicator);
            
            // Join the Agora channel
            // We use numeric UIDs for Agora, but our app uses string IDs.
            // For simplicity in this demo, we'll parse the user's string ID if it's numeric,
            // otherwise, a more robust mapping would be needed.
            // A simple hash function or a backend service is better for production.
            const uid = parseInt(currentUser.id, 36) % 10000000;
            await client.join(AGORA_APP_ID, roomId, null, uid);

            // Fetch room data from Firestore to check roles
            const roomDetails = await geminiService.getAudioRoomDetails(roomId);
            if (roomDetails) {
                 isSpeaker = roomDetails.speakers.some(s => s.id === currentUser.id);
                 if (isSpeaker) {
                    const track = await AgoraRTC.createMicrophoneAudioTrack();
                    localAudioTrack.current = track;
                    await client.publish(track);
                 }
            }
        };

        // Join the room in Firestore first
        geminiService.joinLiveAudioRoom(currentUser.id, roomId).then(setupAgora);

        // Cleanup function
        return () => {
            client.off('user-published', handleUserPublished);
            client.off('user-unpublished', handleUserUnpublished);
            client.off('user-left', handleUserLeft);
            client.off('volume-indicator', handleVolumeIndicator);

            localAudioTrack.current?.stop();
            localAudioTrack.current?.close();
            client.leave();
            geminiService.leaveLiveAudioRoom(currentUser.id, roomId);
        };
    }, [roomId, currentUser.id, onGoBack, onSetTtsMessage]);
    
    // This effect subscribes to real-time Firestore updates for the room state
    useEffect(() => {
        setIsLoading(true);
        const unsubscribe = geminiService.listenToAudioRoom(roomId, (roomDetails) => {
            if (roomDetails) {
                setRoom(roomDetails);
            } else {
                onGoBack(); // Room has ended or doesn't exist
            }
            setIsLoading(false);
        });

        return () => unsubscribe(); // Cleanup subscription on unmount
    }, [roomId, onGoBack]);

    const handleLeave = () => {
        onGoBack();
    };
    
    const handleEndRoom = () => {
        if (window.confirm('Are you sure you want to end this room for everyone?')) {
            geminiService.endLiveAudioRoom(currentUser.id, roomId);
            onGoBack();
        }
    };
    
    const toggleMute = () => {
        if (localAudioTrack.current) {
            const willBeMuted = !isMuted;
            localAudioTrack.current.setMuted(willBeMuted);
            setIsMuted(willBeMuted);
        }
    };

    const handleRaiseHand = () => geminiService.raiseHandInAudioRoom(currentUser.id, roomId);
    const handleInviteToSpeak = (userId: string) => geminiService.inviteToSpeakInAudioRoom(currentUser.id, userId, roomId);
    const handleMoveToAudience = (userId: string) => geminiService.moveToAudienceInAudioRoom(currentUser.id, userId, roomId);


    if (isLoading || !room) {
        return <div className="h-full w-full flex items-center justify-center bg-slate-900 text-white">Loading Room...</div>;
    }
    
    const isHost = room.host.id === currentUser.id;
    const isSpeaker = room.speakers.some(s => s.id === currentUser.id);
    const isListener = !isSpeaker;
    const hasRaisedHand = room.raisedHands.includes(currentUser.id);
    const raisedHandUsers = room.listeners.filter(u => room.raisedHands.includes(u.id));

    return (
        <div className="h-full w-full flex flex-col bg-gradient-to-b from-slate-900 to-black text-white">
            <header className="flex-shrink-0 p-4 flex justify-between items-center bg-black/20">
                <div>
                    <h1 className="text-xl font-bold truncate">{room.topic}</h1>
                    <p className="text-sm text-slate-400">with {room.host.name}</p>
                </div>
                <button onClick={handleLeave} className="bg-red-600 hover:bg-red-500 font-bold py-2 px-4 rounded-lg">
                    Leave
                </button>
            </header>
            
            <main className="flex-grow overflow-y-auto p-6 space-y-8">
                <section>
                    <h2 className="text-lg font-semibold text-slate-300 mb-4">Speakers ({room.speakers.length})</h2>
                    <div className="flex flex-wrap gap-6">
                        {room.speakers.map(speaker => (
                            <Avatar key={speaker.id} user={speaker} isHost={speaker.id === room.host.id} isSpeaking={speaker.id === activeSpeakerId}>
                                {isHost && speaker.id !== currentUser.id && (
                                    <button onClick={() => handleMoveToAudience(speaker.id)} className="text-xs text-red-400 hover:underline">Move to Audience</button>
                                )}
                            </Avatar>
                        ))}
                    </div>
                </section>

                {isHost && raisedHandUsers.length > 0 && (
                     <section>
                        <h2 className="text-lg font-semibold text-green-400 mb-4">Requests to Speak ({raisedHandUsers.length})</h2>
                        <div className="flex flex-wrap gap-6 bg-slate-800/50 p-4 rounded-lg">
                           {raisedHandUsers.map(user => (
                                <Avatar key={user.id} user={user}>
                                    <button onClick={() => handleInviteToSpeak(user.id)} className="text-xs bg-green-500 text-white px-2 py-1 rounded-md font-semibold">Invite to Speak</button>
                                </Avatar>
                           ))}
                        </div>
                    </section>
                )}

                <section>
                    <h2 className="text-lg font-semibold text-slate-300 mb-4">Listeners ({room.listeners.length})</h2>
                    <div className="flex flex-wrap gap-4">
                        {room.listeners.map(listener => (
                            <div key={listener.id} className="relative" title={listener.name}>
                                <img src={listener.avatarUrl} alt={listener.name} className="w-12 h-12 rounded-full" />
                                {room.raisedHands.includes(listener.id) && (
                                     <div className="absolute -bottom-1 -right-1 text-xl bg-slate-700 p-0.5 rounded-full">✋</div>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            </main>
            
            <footer className="flex-shrink-0 p-4 bg-black/20 flex justify-center items-center h-24 gap-4">
                {isHost && <button onClick={handleEndRoom} className="bg-red-700 hover:bg-red-600 font-bold py-3 px-6 rounded-lg text-lg">End Room</button>}
                {isSpeaker && (
                    <button onClick={toggleMute} className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}>
                        <Icon name={isMuted ? 'microphone-slash' : 'mic'} className="w-6 h-6" />
                    </button>
                )}
                {isListener && (
                    <button onClick={handleRaiseHand} disabled={hasRaisedHand} className="bg-lime-600 hover:bg-lime-500 font-bold py-3 px-6 rounded-lg text-lg disabled:bg-slate-500 text-black">
                        {hasRaisedHand ? 'Hand Raised ✋' : 'Raise Hand ✋'}
                    </button>
                )}
            </footer>
        </div>
    );
};

export default LiveRoomScreen;
