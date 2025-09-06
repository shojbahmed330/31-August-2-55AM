import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, RecordingState, ScrollState, ChatTheme } from '../types';
import { geminiService } from '../services/geminiService';
import Icon from './Icon';
import Waveform from './Waveform';
import { CHAT_THEMES, getTtsPrompt, VOICE_EMOJI_MAP } from '../constants';
import { useSettings } from '../contexts/SettingsContext';
import { firebaseService } from '../services/firebaseService';

interface MessageScreenProps {
  currentUser: User;
  recipientUser: User;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  scrollState: ScrollState;
  onBlockUser: (user: User) => void;
  onClose: () => void;
  onCommandProcessed: () => void;
  positionIndex: number;
}

const AVAILABLE_REACTIONS = ['❤️', '😂', '👍', '😢', '🔥', '😮', '😡', '🙏', '🎉', '💯'];
const CHATBOX_WIDTH = 320; // w-80 (80 * 4px)
const CHATBOX_GAP = 16;    // gap-4 (4 * 4px)

const DateSeparator = ({ date, className }: { date: string, className?: string }) => {
    const formattedDate = new Date(date).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric'
    });
    return (
        <div className={`text-center text-xs py-4 ${className}`}>
            {formattedDate}
        </div>
    );
};

// Helper to find last index, useful for "seen" indicator logic
function findLastIndex<T>(array: T[], predicate: (value: T, index: number, obj: T[]) => boolean): number {
    let l = array.length;
    while (l--) {
        if (predicate(array[l], l, array)) return l;
    }
    return -1;
}

const useOnClickOutside = (ref: React.RefObject<HTMLElement>, handler: (event: MouseEvent | TouchEvent) => void) => {
    useEffect(() => {
        const listener = (event: MouseEvent | TouchEvent) => {
            if (!ref.current || ref.current.contains(event.target as Node)) {
                return;
            }
            handler(event);
        };
        document.addEventListener("mousedown", listener);
        document.addEventListener("touchstart", listener);
        return () => {
            document.removeEventListener("mousedown", listener);
            document.removeEventListener("touchstart", listener);
        };
    }, [ref, handler]);
};

const MessageScreen: React.FC<MessageScreenProps> = ({ currentUser, recipientUser, onSetTtsMessage, lastCommand, scrollState, onBlockUser, onClose, onCommandProcessed, positionIndex }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [duration, setDuration] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ChatTheme>('default');
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [isThemePickerOpen, setThemePickerOpen] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  
  // New states for reply and reactions
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionsMenuMessageId, setActionsMenuMessageId] = useState<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [emojiPickerForMessageId, setEmojiPickerForMessageId] = useState<string | null>(null);

  // New states for text and media messaging
  const [newMessage, setNewMessage] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [isRecipientTyping, setIsRecipientTyping] = useState(false);
  const { language } = useSettings();
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playbackTimeoutRef = useRef<number | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useOnClickOutside(menuRef, () => {
    setMenuOpen(false);
    setThemePickerOpen(false);
  });
  
  useOnClickOutside(actionsMenuRef, () => setActionsMenuMessageId(null));
  useOnClickOutside(emojiPickerRef, () => setEmojiPickerForMessageId(null));
  
  const chatId = React.useMemo(() => firebaseService.getChatId(currentUser.id, recipientUser.id), [currentUser.id, recipientUser.id]);
  
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = firebaseService.listenToMessages(chatId, (newMessages) => {
        setMessages(newMessages);
        if (isLoading) { // Only do these on first load
            firebaseService.markMessagesAsRead(chatId, currentUser.id);
            setIsLoading(false);
        }
    });

    return () => unsubscribe();
  }, [chatId, currentUser.id, isLoading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRecipientTyping]);
  
  useEffect(() => {
    const scrollContainer = messageContainerRef.current;
    if (!scrollContainer || scrollState === 'none') return;
    let animationFrameId: number;
    const animateScroll = () => {
        scrollContainer.scrollTop += (scrollState === 'down' ? 2 : -2);
        animationFrameId = requestAnimationFrame(animateScroll);
    };
    animationFrameId = requestAnimationFrame(animateScroll);
    return () => cancelAnimationFrame(animationFrameId);
  }, [scrollState]);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const startTimer = () => {
    stopTimer();
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  };
  
  const handlePlayMessage = (msg: Message) => {
    if (msg.type !== 'audio') return;
    setActiveMessageId(msg.id); // Set as active when played
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    if (playingMessageId === msg.id) {
      setPlayingMessageId(null);
    } else {
      setPlayingMessageId(msg.id);
      playbackTimeoutRef.current = setTimeout(() => setPlayingMessageId(null), (msg.duration || 0) * 1000) as any;
    }
  };

  const startRecording = useCallback(async () => {
    if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
    }
    setRecordingState(RecordingState.IDLE);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioRecorderRef.current = recorder;
        audioChunksRef.current = [];
        recorder.ondataavailable = (event) => audioChunksRef.current.push(event.data);
        recorder.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const newAudioUrl = URL.createObjectURL(audioBlob);
            setAudioUrl(newAudioUrl);
            stream.getTracks().forEach(track => track.stop());
            onSetTtsMessage(getTtsPrompt('message_record_stopped', language, { duration }));
        };
        recorder.start();
        setRecordingState(RecordingState.RECORDING);
        onSetTtsMessage(getTtsPrompt('message_record_start', language));
        startTimer();
    } catch (err) {
        console.error("Mic permission error:", err);
        onSetTtsMessage(getTtsPrompt('error_mic_permission', language));
    }
}, [audioUrl, onSetTtsMessage, startTimer, language, duration]);
  
  const stopRecording = useCallback(() => {
    if (audioRecorderRef.current && audioRecorderRef.current.state === 'recording') {
        audioRecorderRef.current.stop();
        stopTimer();
        setRecordingState(RecordingState.PREVIEW);
    }
  }, [stopTimer]);

  const sendAudioMessage = useCallback(async () => {
    if (!audioUrl) return;

    setRecordingState(RecordingState.UPLOADING);
    onSetTtsMessage("Sending...");
    
    const audioBlob = await fetch(audioUrl).then(r => r.blob());

    await firebaseService.sendMessage(chatId, currentUser, recipientUser, {
        type: 'audio',
        audioBlob,
        duration,
        replyTo: replyingTo ? geminiService.createReplySnippet(replyingTo) : undefined,
    });
    
    onSetTtsMessage(getTtsPrompt('message_sent', language));
    setAudioUrl(null);
    setRecordingState(RecordingState.IDLE);
    setReplyingTo(null);
    setActiveMessageId(null);
    setDuration(0);
  }, [chatId, currentUser, recipientUser, audioUrl, duration, replyingTo, onSetTtsMessage, language]);
  
  const clearMediaPreview = () => {
      setMediaFile(null);
      if(mediaPreview) URL.revokeObjectURL(mediaPreview);
      setMediaPreview(null);
      if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSendMessage = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    onSetTtsMessage("Sending...");
    
    let messageContent: any = {};
    if (mediaFile) {
        messageContent.type = mediaFile.type.startsWith('video') ? 'video' : 'image';
        messageContent.mediaFile = mediaFile;
    } else if (newMessage.trim()) {
        messageContent.type = 'text';
        messageContent.text = newMessage.trim();
    } else {
        onSetTtsMessage("Message is empty.");
        return;
    }

    if (replyingTo) {
        messageContent.replyTo = geminiService.createReplySnippet(replyingTo);
    }

    await firebaseService.sendMessage(chatId, currentUser, recipientUser, messageContent);
    
    setNewMessage('');
    clearMediaPreview();
    onSetTtsMessage(getTtsPrompt('message_sent', language));
    setReplyingTo(null);
    setActiveMessageId(null);
  }, [mediaFile, newMessage, currentUser, recipientUser, onSetTtsMessage, replyingTo, language, chatId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        if(mediaPreview) URL.revokeObjectURL(mediaPreview);
        setMediaFile(file);
        setMediaPreview(URL.createObjectURL(file));
    }
  };

  const handleDeleteChat = async () => {
    if (window.confirm("Are you sure you want to permanently delete this chat history?")) {
        await firebaseService.deleteChatHistory(chatId);
        onSetTtsMessage(getTtsPrompt('chat_deleted', language));
        onClose();
    }
  };
  
  const handleUnsendMessage = async (messageId: string) => {
    await firebaseService.unsendMessage(chatId, messageId, currentUser.id);
    setActionsMenuMessageId(null);
    // The real-time listener will update the UI
  };

  const handleBlock = () => {
     if (window.confirm(`Are you sure you want to block ${recipientUser.name}?`)) {
        onBlockUser(recipientUser);
    }
  }

  const handleThemeChange = async (theme: ChatTheme) => {
    setCurrentTheme(theme);
    await firebaseService.updateChatSettings(chatId, { theme });
    setThemePickerOpen(false);
    setMenuOpen(false);
    onSetTtsMessage(getTtsPrompt('chat_theme_changed', language, { name: CHAT_THEMES[theme].name }));
  }
  
  const handleReactToMessage = useCallback(async (messageId: string, emoji: string) => {
    setActionsMenuMessageId(null);
    setEmojiPickerForMessageId(null);
    await firebaseService.reactToMessage(chatId, messageId, currentUser.id, emoji);
  }, [currentUser.id, chatId]);

  const handleCommand = useCallback(async (command: string) => {
    try {
        const intentResponse = await geminiService.processIntent(command);
        const lastRecipientMessage = messages.slice().reverse().find(m => m.senderId === recipientUser.id);
        
        if (intentResponse.intent === 'intent_unsend_message' && activeMessageId) {
            const messageToUnsend = messages.find(m => m.id === activeMessageId);
            if (messageToUnsend && messageToUnsend.senderId === currentUser.id) {
                handleUnsendMessage(activeMessageId);
                onSetTtsMessage("Message unsent.");
            } else {
                onSetTtsMessage("You can only unsend your own messages.");
            }
            setActiveMessageId(null);
            return;
        }

        switch(intentResponse.intent) {
            case 'intent_go_back': onClose(); break;
            case 'intent_record_message': if (recordingState === RecordingState.IDLE) startRecording(); break;
            case 'intent_stop_recording': if (recordingState === RecordingState.RECORDING) stopRecording(); break;
            case 'intent_send_chat_message': 
                if (recordingState === RecordingState.PREVIEW) sendAudioMessage();
                else if (newMessage.trim() || mediaFile) handleSendMessage();
                break;
            case 'intent_send_text_message_with_content':
                if (intentResponse.slots?.message_content) {
                    setNewMessage(intentResponse.slots.message_content as string);
                    setTimeout(() => handleSendMessage(), 100); // Allow state to update
                }
                break;
            case 'intent_re_record': if (recordingState === RecordingState.PREVIEW) startRecording(); break;
            case 'intent_delete_chat': handleDeleteChat(); break;
            case 'intent_change_chat_theme':
                const themeName = (intentResponse.slots?.theme_name as string)?.toLowerCase();
                if (themeName && themeName in CHAT_THEMES) {
                    handleThemeChange(themeName as ChatTheme);
                }
                break;
        }
    } catch (error) {
        console.error("Error processing command in MessageScreen:", error);
    } finally {
        onCommandProcessed();
    }
  }, [messages, recipientUser.id, activeMessageId, recordingState, startRecording, stopRecording, sendAudioMessage, handleSendMessage, handleDeleteChat, handleThemeChange, onClose, newMessage, mediaFile, currentUser.id, onSetTtsMessage, onCommandProcessed, language]);

  useEffect(() => { if (lastCommand) { handleCommand(lastCommand); } }, [lastCommand, handleCommand]);
  useEffect(() => () => { stopTimer(); if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current); if(mediaPreview) URL.revokeObjectURL(mediaPreview); }, []);

  const theme = CHAT_THEMES[currentTheme] || CHAT_THEMES.default;

  const renderFooter = () => {
    switch (recordingState) {
      case RecordingState.RECORDING:
        return (
          <div className="w-full flex items-center gap-4">
            <div className="w-full h-14 bg-black/20 rounded-lg overflow-hidden"><Waveform isPlaying={true} isRecording={true} /></div>
            <div className={`text-lg font-mono ${theme.text}`}>0:{duration.toString().padStart(2, '0')}</div>
            <button onClick={stopRecording} className="p-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white transition-colors"><Icon name="pause" className="w-6 h-6" /></button>
          </div>
        );
      case RecordingState.PREVIEW:
        return (
            <div className="w-full flex items-center justify-between gap-4">
                <p className={`font-medium ${theme.text}`}>Recorded {duration}s</p>
                <div className="flex items-center gap-3">
                    <button onClick={startRecording} className="px-4 py-2 rounded-lg bg-black/20 hover:bg-black/30 text-white font-semibold transition-colors">Re-record</button>
                    <button onClick={sendAudioMessage} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors">Send</button>
                </div>
            </div>
        );
      case RecordingState.UPLOADING: return <p className={`${theme.text}`}>Sending...</p>
      default:
        const canSend = newMessage.trim() !== '' || mediaFile !== null;
        return (
           <div className="w-full">
                {replyingTo && (
                    <div className={`p-2 mx-1 mb-2 rounded-lg border-l-4 border-rose-500 bg-black/20 ${theme.text}`}>
                        <div className="flex justify-between items-center">
                            <p className="font-semibold text-rose-400 text-sm">Replying to {replyingTo.senderId === currentUser.id ? 'yourself' : recipientUser.name}</p>
                            <button onClick={() => setReplyingTo(null)} className="p-1"><Icon name="close" className="w-4 h-4" /></button>
                        </div>
                        <p className="text-sm opacity-80 truncate">{geminiService.createReplySnippet(replyingTo).content}</p>
                    </div>
                )}
                {mediaPreview && (
                    <div className="relative w-24 h-24 mb-2 p-1 bg-black/20 rounded-lg">
                        {mediaFile?.type.startsWith('video') ? (
                            <video src={mediaPreview} className="w-full h-full object-cover rounded"/>
                        ) : (
                            <img src={mediaPreview} alt="Preview" className="w-full h-full object-cover rounded"/>
                        )}
                        <button onClick={clearMediaPreview} className="absolute -top-2 -right-2 bg-slate-600 text-white rounded-full p-0.5"><Icon name="close" className="w-4 h-4"/></button>
                    </div>
                )}
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className={`p-3 rounded-full hover:bg-white/10 transition-colors ${theme.text}`}><Icon name="add-circle" className="w-6 h-6"/></button>
                    <input 
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type a message..."
                        className={`w-full bg-black/20 rounded-full py-3 px-4 focus:outline-none focus:ring-2 focus:ring-rose-500 transition ${theme.text}`}
                    />
                    <button type={canSend ? 'submit' : 'button'} onClick={!canSend ? startRecording : undefined} className="p-3 rounded-full bg-rose-600 hover:bg-rose-500 text-white transition-colors">
                        <Icon name={canSend ? 'paper-airplane' : 'mic'} className="w-6 h-6"/>
                    </button>
                </form>
            </div>
        );
    }
  };

  const myLastMessageIndex = findLastIndex(messages, (m: Message) => m.senderId === currentUser.id);
  const theirLastMessageIndex = findLastIndex(messages, (m: Message) => m.senderId === recipientUser.id);
  const showSeenIndicator = myLastMessageIndex !== -1 && theirLastMessageIndex > myLastMessageIndex;
  
  const rightOffset = positionIndex * (CHATBOX_WIDTH + CHATBOX_GAP);

  const dynamicStyles: React.CSSProperties = useMemo(() => ({
    transform: `translateX(-${rightOffset}px)`,
    transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
    willChange: 'transform',
  }), [rightOffset]);

  return (
    <div 
        style={dynamicStyles}
        className={`absolute bottom-0 right-0 w-80 h-[450px] rounded-t-lg shadow-2xl flex flex-col border border-lime-500/20 overflow-hidden ${theme.bgGradient} pointer-events-auto`}
    >
        <header className="flex-shrink-0 flex items-center justify-between p-2 border-b border-white/10 bg-black/20 backdrop-blur-sm z-20">
            <div className="flex items-center gap-3">
                <img src={recipientUser.avatarUrl} alt={recipientUser.name} className="w-9 h-9 rounded-full"/>
                <div>
                    <p className={`font-bold text-base ${theme.headerText}`}>{recipientUser.name}</p>
                </div>
            </div>
            <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen(p => !p)} className={`p-1.5 rounded-full hover:bg-white/10 ${theme.headerText}`}><Icon name="ellipsis-vertical" className="w-5 h-5"/></button>
                 {isMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-20 text-white overflow-hidden animate-fade-in-fast">
                       {isThemePickerOpen ? (
                           <div>
                                <button onClick={() => setThemePickerOpen(false)} className="w-full text-left p-2 text-sm flex items-center gap-2 hover:bg-slate-700/50">
                                    <Icon name="back" className="w-4 h-4"/> Back
                                </button>
                                <div className="border-t border-slate-700">
                                    {Object.entries(CHAT_THEMES).map(([key, value]) => (
                                        <button key={key} onClick={() => handleThemeChange(key as ChatTheme)} className="w-full text-left p-2 text-sm flex items-center gap-2 hover:bg-slate-700/50">
                                            <div className={`w-4 h-4 rounded-full ${value.bgGradient}`}></div>
                                            {value.name}
                                            {currentTheme === key && <Icon name="logo" className="w-4 h-4 text-rose-500 ml-auto"/>}
                                        </button>
                                    ))}
                                </div>
                           </div>
                       ) : (
                           <ul className="text-sm">
                               <li><button onClick={(e) => { e.stopPropagation(); onBlockUser(recipientUser);}} className="w-full text-left p-2 flex items-center gap-2 hover:bg-slate-700/50"><Icon name="user-slash" className="w-4 h-4"/> Block</button></li>
                               <li><button onClick={() => setThemePickerOpen(true)} className="w-full text-left p-2 flex items-center gap-2 hover:bg-slate-700/50"><Icon name="swatch" className="w-4 h-4"/> Theme</button></li>
                               <li><button onClick={handleDeleteChat} className="w-full text-left p-2 flex items-center gap-2 text-red-400 hover:bg-red-500/10"><Icon name="trash" className="w-4 h-4"/> Delete</button></li>
                           </ul>
                       )}
                    </div>
                )}
            </div>
             <button onClick={onClose} className={`p-1.5 rounded-full hover:bg-white/10 ${theme.headerText}`}><Icon name="close" className="w-5 h-5"/></button>
        </header>

        <div ref={messageContainerRef} className="flex-grow overflow-y-auto p-4 space-y-1">
            {isLoading ? (
                 <div className="flex items-center justify-center h-full"><p className="text-slate-300">Loading...</p></div>
            ) : (
            <>
                {messages.map((msg, index) => {
                    const isMine = msg.senderId === currentUser.id;
                    const prevMsg = messages[index - 1];
                    const showDate = !prevMsg || new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();
                    
                    return (
                        <React.Fragment key={msg.id}>
                            {showDate && <DateSeparator date={msg.createdAt} className={theme.text} />}
                            <div className={`flex items-end gap-2 w-full ${isMine ? 'justify-end' : 'justify-start'}`}>
                                {!isMine && <img src={recipientUser.avatarUrl} alt="" className="w-7 h-7 rounded-full self-end mb-1 flex-shrink-0"/>}
                                <div className={`max-w-[80%] p-3 rounded-2xl ${isMine ? `${theme.myBubble} rounded-br-md` : `${theme.theirBubble} rounded-bl-md`}`}>
                                    <p className={`${theme.text}`}>{msg.text}</p>
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
                {isRecipientTyping && (
                    <div className="flex items-end gap-2 justify-start animate-fade-in-fast">
                        <img src={recipientUser.avatarUrl} alt="" className="w-7 h-7 rounded-full self-end mb-1"/>
                        <div className={`p-2 rounded-2xl flex items-center gap-3 text-left transition-colors ${theme.theirBubble} rounded-bl-md`}>
                            <div className="h-8 flex-grow min-w-[100px]"><Waveform isPlaying={true} barCount={15} /></div>
                        </div>
                    </div>
                )}
                {showSeenIndicator && (
                    <div className={`text-right text-xs pr-2 ${theme.text}/70`}>
                        Seen
                    </div>
                )}
                <div ref={chatEndRef}></div>
            </>
            )}
        </div>

        <footer className={`flex-shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm z-10 h-[96px] flex justify-center px-2 pt-4 box-border`}>
           {renderFooter()}
        </footer>
    </div>
  );
};

export default MessageScreen;