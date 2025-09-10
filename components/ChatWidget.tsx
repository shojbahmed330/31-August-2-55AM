
import React, { useState, useEffect, useRef } from 'react';
import { User, Message } from '../types';
import { firebaseService } from '../services/firebaseService';
import Icon from './Icon';

interface ChatWidgetProps {
  currentUser: User;
  peerUser: User;
  onClose: (peerId: string) => void;
  onMinimize: (peerId: string) => void;
  onHeaderClick: (peerId: string) => void;
  isMinimized: boolean;
  unreadCount: number;
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ currentUser, peerUser, onClose, onMinimize, onHeaderClick, isMinimized, unreadCount }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatId = firebaseService.getChatId(currentUser.id, peerUser.id);

  useEffect(() => {
    const unsubscribe = firebaseService.listenToMessages(chatId, (newMessages) => {
      setMessages(newMessages);
    });
    return () => unsubscribe();
  }, [chatId]);

  useEffect(() => {
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      firebaseService.markMessagesAsRead(chatId, currentUser.id);
    }
  }, [messages, isMinimized, chatId, currentUser.id]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    await firebaseService.sendMessage(chatId, currentUser, peerUser, {
      type: 'text',
      text: newMessage.trim(),
    });
    setNewMessage('');
  };

  if (isMinimized) {
    return (
      <button onClick={() => onHeaderClick(peerUser.id)} className="w-60 h-12 bg-slate-800 border-t-2 border-lime-500/50 rounded-t-lg flex items-center px-3 gap-2 shadow-lg hover:bg-slate-700">
        <img src={peerUser.avatarUrl} alt={peerUser.name} className="w-8 h-8 rounded-full" />
        <span className="text-white font-semibold truncate flex-grow text-left">{peerUser.name}</span>
        {unreadCount > 0 && <span className="bg-rose-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">{unreadCount}</span>}
        <button onClick={(e) => { e.stopPropagation(); onClose(peerUser.id); }} className="p-1 rounded-full hover:bg-slate-600 text-slate-400">
          <Icon name="close" className="w-4 h-4" />
        </button>
      </button>
    );
  }

  return (
    <div className="w-80 h-[450px] bg-slate-800 rounded-t-lg flex flex-col shadow-2xl border border-b-0 border-slate-700">
      <header onClick={() => onMinimize(peerUser.id)} className="flex-shrink-0 flex items-center justify-between p-2 bg-slate-700 rounded-t-lg cursor-pointer">
        <div className="flex items-center gap-2">
          <img src={peerUser.avatarUrl} alt={peerUser.name} className="w-8 h-8 rounded-full" />
          <span className="text-white font-semibold">{peerUser.name}</span>
        </div>
        <div className="flex items-center">
          <button onClick={(e) => { e.stopPropagation(); onMinimize(peerUser.id); }} className="p-2 rounded-full hover:bg-slate-600 text-slate-400">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" /></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClose(peerUser.id); }} className="p-2 rounded-full hover:bg-slate-600 text-slate-400">
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>
      </header>
      <main className="flex-grow overflow-y-auto p-3 space-y-2">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.senderId === currentUser.id ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl ${msg.senderId === currentUser.id ? 'bg-rose-600 text-white rounded-br-none' : 'bg-slate-600 text-slate-100 rounded-bl-none'}`}>
              <p className="text-sm break-words">{msg.text}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>
      <footer className="p-2 border-t border-slate-700">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="w-full bg-slate-600 text-slate-100 rounded-full py-2 px-4 focus:outline-none focus:ring-2 focus:ring-rose-500 text-sm"
          />
          <button type="submit" className="p-2 rounded-full bg-rose-600 text-white hover:bg-rose-500 disabled:bg-slate-500">
            <Icon name="paper-airplane" className="w-5 h-5" />
          </button>
        </form>
      </footer>
    </div>
  );
};
export default ChatWidget;
