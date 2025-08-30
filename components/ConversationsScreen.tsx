

import React, { useState, useEffect, useCallback } from 'react';
import { User, Conversation, AppView, Message } from '../types';
import { geminiService } from '../services/geminiService';
import Icon from './Icon';
import { getTtsPrompt } from '../constants';
import { useSettings } from '../contexts/SettingsContext';

interface ConversationsScreenProps {
  currentUser: User;
  onOpenConversation: (peer: User) => void;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onCommandProcessed: () => void;
  onGoBack: () => void;
}

const ConversationItem: React.FC<{ conversation: Conversation; currentUserId: string; onClick: () => void }> = ({ conversation, currentUserId, onClick }) => {
    const { peer, lastMessage, unreadCount } = conversation;
    const isLastMessageFromMe = lastMessage.senderId === currentUserId;

    const timeAgo = new Date(lastMessage.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
    
    const getSnippet = (message: Message): string => {
        const prefix = isLastMessageFromMe ? 'You: ' : '';
        switch (message.type) {
            case 'text':
                return prefix + (message.text || '');
            case 'image':
                return prefix + 'Sent an image 📷';
            case 'video':
                return prefix + 'Sent a video 📹';
            case 'audio':
            default:
                return prefix + `Voice message · ${message.duration}s`;
        }
    };

    const snippet = getSnippet(lastMessage);

    return (
        <button onClick={onClick} className={`w-full text-left p-3 flex items-center gap-4 rounded-lg transition-colors hover:bg-slate-700/50 ${unreadCount > 0 ? 'bg-slate-700' : ''}`}>
            <div className="relative flex-shrink-0">
                <img src={peer.avatarUrl} alt={peer.name} className="w-14 h-14 rounded-full" />
            </div>
            <div className="flex-grow overflow-hidden">
                <div className="flex justify-between items-baseline">
                    <p className={`font-bold text-lg truncate ${unreadCount > 0 ? 'text-white' : 'text-slate-200'}`}>{peer.name}</p>
                    <p className="text-xs text-slate-400 flex-shrink-0">{timeAgo}</p>
                </div>
                <div className="flex justify-between items-center mt-1">
                    <p className={`text-sm truncate ${unreadCount > 0 ? 'text-slate-100 font-medium' : 'text-slate-400'}`}>{snippet}</p>
                    {unreadCount > 0 && (
                        <span className="flex-shrink-0 ml-4 w-6 h-6 bg-rose-500 text-white text-xs font-bold rounded-full flex items-center justify-center">{unreadCount}</span>
                    )}
                </div>
            </div>
        </button>
    )
};


const ConversationsScreen: React.FC<ConversationsScreenProps> = ({ currentUser, onOpenConversation, onSetTtsMessage, lastCommand, onCommandProcessed, onGoBack }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { language } = useSettings();

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    const convos = await geminiService.getConversations(currentUser.id);
    setConversations(convos);
    setIsLoading(false);
    onSetTtsMessage(getTtsPrompt('conversations_loaded', language));
  }, [currentUser.id, onSetTtsMessage, language]);


  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleCommand = useCallback(async (command: string) => {
    try {
        const userNames = conversations.map(c => c.peer.name);
        const intentResponse = await geminiService.processIntent(command, { userNames });

        switch (intentResponse.intent) {
            case 'intent_go_back':
                onGoBack();
                break;
            case 'intent_reload_page':
                onSetTtsMessage("Reloading conversations...");
                fetchConversations();
                break;
            case 'intent_open_chat':
                if (intentResponse.slots?.target_name) {
                    const targetName = intentResponse.slots.target_name as string;
                    const targetConversation = conversations.find(c => c.peer.name.toLowerCase() === (targetName).toLowerCase());
                    if (targetConversation) {
                        onOpenConversation(targetConversation.peer);
                    } else {
                        onSetTtsMessage(`I couldn't find a conversation with ${targetName}.`);
                    }
                }
                break;
        }
    } catch (error) {
        console.error("Error processing command in ConversationsScreen:", error);
    } finally {
        onCommandProcessed();
    }
  }, [conversations, onOpenConversation, onSetTtsMessage, onCommandProcessed, onGoBack, fetchConversations]);

  // Handle voice commands to open a chat
  useEffect(() => {
    if (lastCommand) {
        handleCommand(lastCommand);
    }
  }, [lastCommand, handleCommand]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">Loading conversations...</p></div>;
  }

  return (
    <div className="h-full w-full overflow-y-auto p-4 sm:p-6 bg-slate-900">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-slate-100">Messages</h1>
          <button className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
              <Icon name="edit" className="w-6 h-6" />
          </button>
        </div>
        
        {conversations.length > 0 ? (
           <div className="flex flex-col gap-2">
                {conversations.map(convo => (
                    <ConversationItem key={convo.peer.id} conversation={convo} currentUserId={currentUser.id} onClick={() => onOpenConversation(convo.peer)} />
                ))}
           </div>
        ) : (
          <div className="text-center py-20">
              <Icon name="message" className="w-16 h-16 mx-auto text-slate-600 mb-4" />
              <h2 className="text-xl font-bold text-slate-300">No messages yet</h2>
              <p className="text-slate-400 mt-2">When you start a new conversation, it will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationsScreen;
