import { GoogleGenAI, Type } from "@google/genai";
import { NLUResponse, MusicTrack, User, Post, Campaign, FriendshipStatus, Comment, Message, Conversation, ChatSettings, LiveAudioRoom, LiveVideoRoom, Group, Story, Event, GroupChat, JoinRequest, GroupCategory, StoryPrivacy, PollOption, AdminUser, CategorizedExploreFeed, Report } from '../types';
import { VOICE_EMOJI_MAP, MOCK_MUSIC_LIBRARY, DEFAULT_AVATARS, DEFAULT_COVER_PHOTOS } from '../constants';
import { firebaseService } from './firebaseService';


// --- Gemini API Initialization ---
const apiKey = process.env.API_KEY;
if (!apiKey) {
    alert("CRITICAL ERROR: Gemini API key is not configured. Please ensure your environment variables are set up correctly.");
    throw new Error("API_KEY not configured. Please set it in your environment.");
}
const ai = new GoogleGenAI({ apiKey });

const NLU_SYSTEM_INSTRUCTION_BASE = `
You are a powerful NLU (Natural Language Understanding) engine for VoiceBook, a voice-controlled social media app. Your sole purpose is to analyze a user's raw text command and convert it into a structured JSON format. You must understand both English and Bengali (Bangla), including "Banglish" (Bengali words typed with English characters).

Your response MUST be a single, valid JSON object and nothing else.

The JSON object must have:
1. An "intent" field: A string matching one of the intents from the list below.
2. An optional "slots" object: For intents that require extra information (like a name or number).

If the user's intent is unclear or not in the list, you MUST use the intent "unknown".

Example Bengali commands:
- "পাসওয়ার্ড পরিবর্তন কর" -> { "intent": "intent_change_password" }
- "আমার অ্যাকাউন্ট নিষ্ক্রিয় কর" -> { "intent": "intent_deactivate_account" }
- "সেটিংসে যাও" -> { "intent": "intent_open_settings" }
- "shojib ke khojo" -> { "intent": "intent_search_user", "slots": { "target_name": "shojib" } }
- "add text Fine" -> { "intent": "intent_add_text_to_story", "slots": { "text": "Fine" } }
- "likho Fine" -> { "intent": "intent_add_text_to_story", "slots": { "text": "Fine" } }
- "send a heart emoji" -> { "intent": "intent_send_voice_emoji", "slots": { "emoji_type": "heart" } }
- "bhalobasha emoji pathao" -> { "intent": "intent_send_voice_emoji", "slots": { "emoji_type": "love" } }

--- INTENT LIST ---
- intent_signup, intent_login
- intent_play_post, intent_pause_post, intent_next_post, intent_previous_post
- intent_create_post, intent_stop_recording, intent_post_confirm, intent_re_record
- intent_comment (extracts optional 'target_name'), intent_post_comment, intent_view_comments (extracts optional 'target_name')
- intent_view_comments_by_author (extracts 'target_name')
- intent_play_comment_by_author (extracts 'target_name')
- intent_search_user (extracts 'target_name')
- intent_select_result (extracts 'index')
- intent_like (extracts optional 'target_name'), intent_share
- intent_open_profile (extracts optional 'target_name'. If no name, it's the current user.)
- intent_go_back, intent_open_settings, intent_edit_profile
- intent_add_friend, intent_send_message
- intent_save_settings
- intent_update_profile (extracts 'field' like 'name', 'bio', 'work', 'education', 'hometown', 'currentCity', 'relationshipStatus' and 'value')
- intent_update_privacy (extracts 'setting' like 'postVisibility' or 'friendRequestPrivacy', and 'value' like 'public', 'friends', 'everyone', 'friends_of_friends')
- intent_update_notification_setting (extracts 'setting' like 'likes', 'comments', 'friendRequests', 'campaignUpdates', 'groupPosts' and 'value' which is 'on' or 'off')
- intent_block_user (extracts 'target_name')
- intent_unblock_user (extracts 'target_name')
- intent_record_message, intent_send_chat_message
- intent_send_text_message_with_content (extracts 'message_content'. Used when the user dictates a text message to send. Examples: "likho kamon acho", "text him that I am running late", "write how are you", "message pathao I'll call you back")
- intent_send_voice_emoji (extracts 'emoji_type'. Examples: "send laughing emoji", "send a heart", "kanna emoji pathao")
- intent_react_to_message (extracts 'emoji_type'. Targets the active message. Examples: "react with a heart", "love reaction", "like this")
- intent_reply_to_message (Targets the active message. Examples: "reply", "reply to this message")
- intent_reply_to_last_message (extracts 'message_content'. Targets the last received message. Examples: "reply to the last message that I am on my way", "sesh message er reply koro je ami valo achi")
- intent_react_to_last_message (extracts 'emoji_type'. Targets the last received message. Examples: "react to last message with love", "love dao", "sesh message e hashi dao")
- intent_open_friend_requests, intent_accept_request, intent_decline_request
- intent_open_friends_page
- intent_open_messages
- intent_open_chat (extracts 'target_name')
- intent_change_chat_theme (extracts 'theme_name')
- intent_delete_chat
- intent_generate_image (extracts 'prompt')
- intent_clear_image
- intent_scroll_up, intent_scroll_down, intent_stop_scroll
- intent_claim_reward
- intent_help, unknown
- intent_open_ads_center, intent_create_campaign, intent_view_campaign_dashboard
- intent_set_sponsor_name (extracts 'sponsor_name')
- intent_set_campaign_caption (extracts 'caption_text')
- intent_set_campaign_budget (extracts 'budget_amount')
- intent_set_media_type (extracts 'media_type' which can be 'image', 'video', 'audio')
- intent_launch_campaign
- intent_change_password
- intent_deactivate_account
- intent_open_feed
- intent_open_rooms_hub, intent_open_audio_rooms, intent_open_video_rooms, intent_create_room, intent_close_room
- intent_reload_page
- intent_open_groups_hub
- intent_join_group (extracts 'group_name')
- intent_leave_group (extracts 'group_name')
- intent_create_group (extracts 'group_name')
- intent_search_group (extracts 'search_query')
- intent_filter_groups_by_category (extracts 'category_name'. Examples: "show food groups", "gaming group dekhaw")
- intent_pin_post, intent_unpin_post
- intent_open_group_chat, intent_open_group_events
- intent_create_event, intent_create_poll, intent_vote_poll (extracts 'option_number' or 'option_text')
- intent_view_group_by_name (extracts 'group_name')
- intent_manage_group
- intent_open_group_invite_page
- intent_create_story, intent_add_music, intent_post_story
- intent_set_story_privacy (extracts 'privacy_level' which can be 'public' or 'friends')
- intent_add_text_to_story (extracts 'text')
- intent_send_announcement (extracts 'message_content')
`;

// A map of simple phrases to intents for fast, offline-first command processing.
const commandMap: { intent: NLUResponse['intent']; phrases: string[] }[] = [
  // Auth
  { intent: 'intent_login', phrases: ['log in', 'login', 'login koro', 'লগ ইন', 'লগইন'] },
  { intent: 'intent_signup', phrases: ['sign up', 'signup', 'register', 'create account', 'নতুন অ্যাকাউন্ট', 'সাইন আপ'] },
  // Navigation
  { intent: 'intent_go_back', phrases: ['go back', 'back', 'return', 'exit', 'nevermind', 'cancel', 'phire jao', 'pechone jao', 'back koro', 'ফিরে যাও', 'পেছনে যাও', 'ব্যাক কর', 'আগের পেজে যাও', 'পেছনে যাও', 'ফিরে যাও', 'আগের পেজে যাও', 'ব্যাক করো', 'আগের দিকে ফিরে যাও', 'previous page', 'back page khulo', 'back to previous', 'go previous', 'page back khulo', 'move back', 'previous khulo'] },
  { intent: 'intent_open_feed', phrases: ['go home', 'show feed', 'open feed', 'amar feed', 'হোম', 'ফিড', 'আমার ফিড', 'হোমে যাও', 'হোম এ যাও', 'হোম খুলো', 'শুরুতে যাও', 'মেইন পেজে যাও', 'প্রথম পেজ খোলো', 'hom e jao', 'hom jao', 'home jao', 'open home', 'back to home', 'take me home', 'open main page', 'show home page'] },
  { intent: 'intent_open_friends_page', phrases: ['open friends', 'show friends', 'friends', 'friend list', 'বন্ধু', 'ফ্রেন্ডস', 'বন্ধুদের দেখাও', 'friends a jao', 'ফ্রেন্ডসে যাও', 'ফ্রেন্ড এ যাও', 'ফ্রেন্ড লিস্ট খোলো', 'আমার ফ্রেন্ডস দেখাও', 'বন্ধুদের লিস্ট খোলো', 'বন্ধুদের কাছে যাও', 'amar friends dekhte chai', 'friend e jao', 'friends open', 'go to friends', 'open friends list', 'see my friends', 'friends section khulo', 'all friends list open', 'ফ্রেন্ড সাজেশন খোলো', 'ফ্রেন্ড সাজেশন দেখাও', 'সাজেস্টেড ফ্রেন্ডস খোলো', 'সাজেস্টেড লিস্ট দেখাও', 'বন্ধু সাজেশন দেখাও', 'amar friend suggestion dekhte chai', 'suggestion e jao', 'friend suggestion open', 'show suggestions', 'open friend suggestions', 'see suggested friends', 'friend recommend page', 'check suggestions', 'recommended friends list', 'সব বন্ধু দেখাও', 'আমার সব বন্ধু দেখাও', 'অল ফ্রেন্ডস খোলো', 'সব বন্ধু লিস্ট দেখাও', 'complete friends list দেখাও', 'amar all friends dekhte chai', 'all friends e jao', 'show all friends', 'open all friends list', 'see all friends', 'friends list khulo', 'friends section open', 'check all friends', 'all my friends', 'full friends list open'] },
  { intent: 'intent_open_friend_requests', phrases: ['ফ্রেন্ড রিকোয়েস্ট খোলো', 'ফ্রেন্ড রিকোয়েস্ট দেখাও', 'নতুন ফ্রেন্ড রিকোয়েস্ট', 'রিকোয়েস্ট গুলো দেখাও', 'pending request খোলো', 'amar friend request dekhte chai', 'friend request e jao', 'request list open', 'check requests', 'show friend requests', 'open requests', 'see all requests', 'friend requests page', 'requests dekhao', 'add request list'] },
  { intent: 'intent_open_messages', phrases: ['open messages', 'show messages', 'messages', 'inbox', 'go to message', 'মেসেজ', 'message a jao', 'message box on koro', 'মেসেজ খোলো', 'চ্যাট খোলো', 'নতুন মেসেজ দেখাও', 'মেসেজ লিস্ট খোলো', 'আমার মেসেজ দেখাও', 'message khulo', 'go to messages', 'see messages', 'message section khulo', 'check messages', 'view messages', 'my messages'] },
  { intent: 'intent_open_settings', phrases: ['open settings', 'go to settings', 'settings', 'সেটিংস', 'সেটিংসে যাও', 'setting a jao'] },
  { intent: 'intent_open_ads_center', phrases: ['open ads center', 'ads center', 'my ads', 'my campaigns', 'sponsor center', 'amar campaign', 'অ্যাডস সেন্টারে যাও', 'অ্যাডস সেন্টার', 'বিজ্ঞাপন', 'আমার বিজ্ঞাপন'] },
  { intent: 'intent_view_campaign_dashboard', phrases: ['অ্যাড ড্যাশবোর্ড খোলো', 'বিজ্ঞাপন প্যানেল দেখাও', 'অ্যাডের তথ্য দেখাও', 'প্রচার প্যানেল খোলো', 'আমার অ্যাড ড্যাশবোর্ড দেখাও', 'ads dashboard khulo', 'open ads dashboard', 'show ads dashboard', 'go to ads dashboard', 'dashboard section khulo', 'my ads panel khulo', 'ads stats khulo', 'check ads dashboard', 'view ads dashboard', 'ads analytics khulo'] },
  { intent: 'intent_create_campaign', phrases: ['নতুন ক্যাম্পেইন তৈরি করো', 'নতুন প্রচারণা খোলো', 'নতুন অ্যাড ক্যাম্পেইন করো', 'নতুন প্রচার শুরু করো', 'create new campaign', 'open new campaign', 'start new campaign', 'add new campaign', 'launch campaign', 'campaign setup khulo', 'new campaign khulo', 'initiate campaign', 'begin new campaign', 'generate campaign', 'campaign create khulo'] },
  { intent: 'intent_open_profile', phrases: ['my profile', 'show my profile', 'amar profile', 'আমার প্রোফাইল', 'profile a jao'] },
  { intent: 'intent_open_rooms_hub', phrases: ['rooms', 'live rooms', 'go to rooms', 'রুম', 'রুমস', 'লাইভ রুম', 'rooms er vitore jaa', 'রুম খোলো', 'রুমে যাও', 'রুম দেখাও', 'রুম লিস্ট খোলো', 'আমার রুম দেখাও', 'room khulo', 'open room', 'show rooms', 'go to room', 'see rooms', 'room section khulo', 'all rooms khulo', 'my rooms dekhte chai', 'room list open', 'enter room'] },
  { intent: 'intent_open_audio_rooms', phrases: ['audio rooms', 'voice rooms', 'অডিও রুম', 'অডিও রুম খোলো', 'অডিও রুমে যাও', 'অডিও রুম দেখাও', 'সাউন্ড রুম খোলো', 'আমার অডিও রুম দেখাও', 'audio room khulo', 'open audio room', 'show audio rooms', 'go to audio room', 'audio section khulo', 'join audio room', 'audio rooms open', 'my audio room dekhte chai', 'audio room list khulo', 'enter audio room'] },
  { intent: 'intent_open_video_rooms', phrases: ['video rooms', 'video calls', 'ভিডিও রুম'] },
  { intent: 'intent_create_room', phrases: ["রুম তৈরি করো", "নতুন রুম খোলো", "রুম ক্রিয়েট করো", "নতুন রুম তৈরি করো", "create room khulo", "create new room", "make room", "open new room", "room add karo", "add new room", "generate room", "start new room", "room setup khulo", "build room", "create my room", "রুম শুরু করো", "রুম চালু করো", "রুম স্টার্ট করো", "রুম চালু দাও", "নতুন রুম শুরু করো", "start room", "start rooms", "begin room", "launch room", "room start khulo", "start this room", "start all rooms", "initiate room", "activate room"] },
  { intent: 'intent_close_room', phrases: ["রুম বাতিল করো", "রুম বন্ধ করো", "রুম ক্যান্সেল করো", "রুম বন্ধ দাও", "রুম বন্ধ খোলো", "cancel room", "cancel rooms", "close room", "delete room", "stop room", "room cancel khulo", "cancel this room", "cancel all rooms", "remove room", "abort room"] },
  { intent: 'intent_open_groups_hub', phrases: ['groups', 'open groups', 'show groups', 'গ্রুপ', 'গ্রুপস', 'গ্রুপগুলো দেখাও', 'go to groups', 'groups a jao', 'গ্রুপসে যাও', 'গ্রুপ খোলো', 'গ্রুপ দেখাও', 'গ্রুপ লিস্ট খোলো', 'গ্রুপ প্যানেল খোলো', 'amar groups dekhte chai', 'group e jao', 'group section open', 'group dashboard khulo', 'my groups dekhabo', 'check groups', 'all groups open'] },
  { intent: 'intent_search_group', phrases: ['search groups', 'find groups', 'group search', 'search for a group', 'গ্রুপ খোঁজ', 'গ্রুপ সার্চ', 'group khujo', 'group search koro'] },
  // In-group commands
  { intent: 'intent_manage_group', phrases: ['manage group', 'group settings', 'groups setting a jao', 'manage a jao', 'গ্রুপ সেটিংস', 'গ্রুপ ম্যানেজ খোলো', 'গ্রুপ ম্যানেজে যাও', 'গ্রুপ কন্ট্রোল খোলো', 'গ্রুপ প্রশাসন দেখাও', 'গ্রুপ সেটিংস ম্যানেজ করো', 'group manage e jao', 'open group manage', 'group admin khulo', 'grp controls khulo', 'group dashboard khulo', 'group owner khulo', 'group edit khulo', 'grp permission dekhte chai', 'control group settings', 'গ্রুপ সেটিংস খোলো', 'গ্রুপ সেটিংসে যাও', 'গ্রুপ কনফিগারেশন খোলো', 'সেটিংস দেখাও', 'গ্রুপ প্রেফারেন্স খোলো', 'group settings e jao', 'open group settings', 'grp settings khulo', 'settings in group', 'group option khulo', 'grp control khulo', 'edit group settings', 'admin settings khulo', 'grp details khulo', 'group setup khulo'] },
  { intent: 'intent_open_group_invite_page', phrases: ['invite to group', 'invite friends', 'invite', 'বন্ধুদের আমন্ত্রণ', 'groups invite a jao', 'গ্রুপে আমন্ত্রণ করো', 'গ্রুপে বন্ধু যোগ করো', 'গ্রুপে ইনভাইট করো', 'বন্ধুদের গ্রুপে নাও', 'নতুন সদস্য যোগ করো', 'group invite', 'send invite', 'add to group', 'grp invite', 'invite members', 'grp add', 'send group invite', 'grp sharing'] },
  { intent: 'intent_open_group_chat', phrases: ['group chat', 'chat', 'চ্যাট', 'groups chat a jao', 'গ্রুপ চ্যাট খোলো', 'গ্রুপ চ্যাটে যাও', 'গ্রুপ মেসেজ দেখাও', 'মেসেজ খোলো', 'group chat e jao', 'open group chat', 'show group chat', 'go to group chat', 'grp message khulo', 'group inbox khulo', 'see group chat', 'grp chatroom khulo', 'open grp messenger', 'group dm dekhte chai'] },
  { intent: 'intent_open_group_events', phrases: ['group events', 'events', 'ইভেন্ট', 'groups events a jao'] },
  { intent: 'intent_leave_group', phrases: ['গ্রুপ ছাড়ো', 'গ্রুপ ত্যাগ করো', 'গ্রুপ থেকে বের হও', 'গ্রুপে না যাও', 'গ্রুপ লিভ করো', 'leave group', 'grp exit', 'exit this group', 'quit group', 'grp leave', 'remove from group', 'grp quit', 'group out khulo', 'grp escape', 'grp disconnect'] },
  // Feed Actions
  { intent: 'intent_next_post', phrases: ['next post', 'next', 'porer post', 'porerta', 'পরেরটা', 'পরের পোস্ট'] },
  { intent: 'intent_previous_post', phrases: ['previous post', 'previous', 'ager post', 'agerta', 'আগেরটা', 'আগের পোস্ট', 'আগেরটা দেখাও', 'আগের ট্যাবে যাও', 'পূর্বের কন্টেন্ট দেখাও', 'আগের পেজ দেখাও', 'পূর্বের আইটেমে যাও', 'ager tai jao', 'previous one', 'go previous', 'show previous', 'previous item khulo', 'back to previous', 'previous page khulo', 'show last', 'move to previous', 'open previous'] },
  { intent: 'intent_play_post', phrases: ['play', 'play post', 'start playing', 'chalu koro', 'play koro', 'চালু কর', 'প্লে কর'] },
  { intent: 'intent_pause_post', phrases: ['pause', 'pause post', 'stop playing', 'bondho koro', 'thamaw', 'পজ কর', 'বন্ধ কর', 'থামাও'] },
  { intent: 'intent_like', phrases: ['like this', 'like post', 'like', 'লাইক', 'like dao'] },
  { intent: 'intent_comment', phrases: ['comment', 'leave a comment', 'add comment', 'কমেন্ট', 'comment koro'] },
  { intent: 'intent_create_post', phrases: ['create a post', 'new post', 'make a post', 'পোস্ট কর', 'নতুন পোস্ট', 'voice post', 'voice status', 'status dao', 'গ্রুপে পোস্ট করো', 'নতুন পোস্ট খোলো', 'পোস্ট শেয়ার করো', 'গ্রুপে লিখো', 'পোস্ট তৈরি করো', 'group post', 'post in group', 'grp post', 'add post group', 'new post group', 'share in group', 'publish group', 'grp publish', 'grp add post', 'post something group'] },
  
  // Recording
  { intent: 'intent_stop_recording', phrases: ['stop recording', 'finish recording', 'রেকর্ডিং বন্ধ কর', 'stop koro', 'sesh koro'] },
  { intent: 'intent_post_confirm', phrases: ['post it', 'confirm post', 'post', 'publish', 'পোস্ট কর', 'হ্যাঁ পোস্ট কর'] },
  { intent: 'intent_re_record', phrases: ['rerecord', 're-record', 'record again', 'abar record koro', 'আবার রেকর্ড কর'] },
  { intent: 'intent_post_comment', phrases: ['post comment', 'send comment', 'comment post koro'] },

  // Messaging
  { intent: 'intent_record_message', phrases: ['record message', 'new message', 'মেসেজ রেকর্ড কর'] },
  { intent: 'intent_send_chat_message', phrases: ['send message', 'send', 'pathao', 'মেসেজ পাঠাও', 'পাঠাও'] },
  { intent: 'intent_reply_to_message', phrases: ['reply', 'reply to this', 'reply koro', 'uttor dao', 'রিপ্লাই কর', 'উত্তর দাও'] },
  { intent: 'intent_delete_chat', phrases: ['চ্যাট মুছে দাও', 'মেসেজ মুছে ফেলো', 'এই চ্যাট ডিলিট করো', 'মেসেজ লিস্ট খালি করো', 'চ্যাট রিমুভ করো', 'delete chat', 'remove chat', 'delete message', 'clear chat', 'erase messages', 'chat delete khulo', 'remove messages', 'wipe chat', 'delete conversation', 'chat erase khulo'] },
  { intent: 'intent_change_chat_theme', phrases: ['থিম পরিবর্তন করো', 'চ্যাট থিম বদলো', 'রঙ পরিবর্তন করো', 'নতুন থিম খোলো', 'থিম সেটিংস দেখাও', 'change theme', 'theme change khulo', 'open theme settings', 'switch theme', 'set new theme', 'theme option khulo', 'apply theme', 'theme customize khulo', 'pick new theme', 'update theme'] },

  // Scrolling
  { intent: 'intent_scroll_down', phrases: ['scroll down', 'go down', 'scroll koro', 'niche jao', 'নিচে যাও', 'নিচে নামো', 'নিচে স্ক্রল করো', 'স্ক্রল করে নিচে যাও', 'নিচের দিকে যাও', 'নিচে দেখাও', 'niche namo', 'scroll niche', 'move down', 'scroll lower', 'go to bottom', 'scroll to bottom', 'downward scroll khulo', 'scroll page down'] },
  { intent: 'intent_scroll_up', phrases: ['scroll up', 'go up', 'upore jao', 'উপরে যাও', 'উপরে যাও', 'উপরে স্ক্রল করো', 'স্ক্রল করে উপরে যাও', 'উপরের দিকে দেখাও', 'উপরে উঠাও', 'opore scroll koro', 'move up', 'scroll top', 'scroll higher', 'top e jao', 'scroll page up', 'upward scroll khulo', 'scroll to top'] },
  { intent: 'intent_stop_scroll', phrases: ['stop scrolling', 'stop scroll', 'scrolling bondho koro', 'scrolling thamaw', 'স্ক্রল বন্ধ করো', 'স্ক্রল অফ করো', 'স্ক্রল নিস্ক্রিয় করো', 'স্ক্রল ডিএক্টিভেট করো', 'স্ক্রল রুখো', 'scroll off', 'turn off scroll', 'disable scroll', 'scroll stop khulo', 'scroll deactivate', 'scroll disable khulo', 'scroll off page', 'scroll off now', 'scroll cancel khulo'] },
  
  // Account Management
  { intent: 'intent_change_password', phrases: ['change password', 'password change', 'update password', 'পাসওয়ার্ড পরিবর্তন', 'পাসওয়ার্ড চেঞ্জ'] },
  { intent: 'intent_deactivate_account', phrases: ['deactivate account', 'deactivate my account', 'অ্যাকাউন্ট নিষ্ক্রিয়', 'অ্যাকাউন্ট ডিএক্টিভেট', 'amar account deactivate koro'] },

  // General
  { intent: 'intent_help', phrases: ['help', 'help me', 'what can i say', 'সাহায্য'] },
  { intent: 'intent_reload_page', phrases: ['reload', 'refresh', 'reload page', 'refresh page', 'রিফ্রেশ', 'রিফ্রেশ কর', 'রিলোড', 'reload koro', 'reload dao', 'রিফ্রেশ করো', 'পেজ রিফ্রেশ করো', 'পুনরায় লোড করো', 'লোড আবার করো', 'পুনরায় দেখাও', 'update page', 'refresh khulo', 'reload now', 'refresh content', 'update content', 'page refresh khulo'] },

  // New Group Engagement
  { intent: 'intent_pin_post', phrases: ['pin post', 'pin this post', 'এই পোস্টটি পিন কর'] },
  { intent: 'intent_unpin_post', phrases: ['unpin post', 'unpin this post', 'পোস্ট আনপিন কর'] },
  { intent: 'intent_create_event', phrases: ['create event', 'new event', 'নতুন ইভেন্ট তৈরি কর'] },
  { intent: 'intent_create_poll', phrases: ['create a poll', 'add poll', 'পোল তৈরি কর'] },

  // Story Creation
  { intent: 'intent_create_story', phrases: ['create story', 'add story', 'new story', 'story banao', 'create a story', 'স্টোরি বানাও'] },
  { intent: 'intent_add_music', phrases: ['add music', 'set music', 'music lagao', 'gaan add koro', 'মিউজিক অ্যাড কর'] },
  { intent: 'intent_post_story', phrases: ['post story', 'share story', 'story share koro', 'publish story', 'স্টোরি শেয়ার কর', 'post koro'] },
];

const localRules: { intent: NLUResponse['intent']; regex: RegExp; slots: string[] }[] = [
    { intent: 'intent_reply_to_last_message', regex: /^(?:reply to last message|last message reply|sesh message er reply koro je|last message er reply koro je|last message a reply koro)\s+(.+)$/i, slots: ['message_content'] },
    { intent: 'intent_send_text_message_with_content', regex: /^(?:text|message|likho|lekho|pathao)\s+(?:him|her|them\s+)?(?:that\s+)?(.+)$/i, slots: ['message_content'] },
    { intent: 'intent_add_text_to_story', regex: /^(?:story te likho|write on story|story te lekho|story likho|add text)\s+(.+)$/i, slots: ['text'] },
    { intent: 'intent_open_chat', regex: /^(?:open chat with|chat with|message|chat koro|message pathao)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_search_user', regex: /^(?:search for|find|look up|khojo|search)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_add_friend', regex: /^(?:add|friend request|bondhu banaw)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_accept_request', regex: /^(?:accept|accept request from)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_decline_request', regex: /^(?:decline|decline request from)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_block_user', regex: /^(?:block)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_unblock_user', regex: /^(?:unblock)\s+(.+)$/i, slots: ['target_name'] },
    { intent: 'intent_generate_image', regex: /^(?:generate|create|make|draw)\s+(?:an image of\s+)?(.+)$/i, slots: ['prompt'] },
    { intent: 'intent_update_profile', regex: /^(?:set|change|update)\s+(?:my\s+)?(name|bio|work|education|hometown|current city|relationship status)\s+to\s+(.+)$/i, slots: ['field', 'value'] },
    { intent: 'intent_vote_poll', regex: /^(?:vote for|select|choose)\s+(?:option\s+)?(.+)$/i, slots: ['option_text'] },
    { intent: 'intent_filter_groups_by_category', regex: /(?:go to|open|show|dekhaw|যাও|খুলো|দেখাও)?\s*(general|food|gaming|music|technology|travel|art & culture|sports)\s*(?:group|groups|গ্রুপে|গ্রুপ|ফিড|খুলো|খোলো|যাও|e jao|a jao)/i, slots: ['category_name'] },
    // This rule is more specific and must come before the generic profile rule
    { intent: 'intent_view_group_by_name', regex: /^(?:go to|open|view|show|jao)?\s*(.+?)\s+(?:group|groups)(?:\s+a jao)?$/i, slots: ['group_name'] },
    { intent: 'intent_open_profile', regex: /^(?:go to|open|show|view|jao|dekhao)\s+(.+?)(?:'s)?(?:\s+profile|\s+er profile|\s+a jao)?$/i, slots: ['target_name'] },
];


const processLocalIntent = (command: string): NLUResponse | null => {
    const lowerCommand = command.toLowerCase().trim();

    // 1. Check complex regex-based rules first
    for (const rule of localRules) {
        const match = lowerCommand.match(rule.regex);
        if (match) {
            const slots: { [key: string]: string | number } = {};
            rule.slots.forEach((slotName, index) => {
                if (match[index + 1]) {
                    let value = match[index + 1].trim();
                    if (slotName === 'field' && value === 'current city') {
                        value = 'currentCity';
                    } else if (slotName === 'field' && value === 'relationship status') {
                        value = 'relationshipStatus';
                    }
                    slots[slotName] = value;
                }
            });
            // Special handling to avoid collisions
            if (rule.intent === 'intent_open_profile' && slots.target_name) {
                const navCommands = ['message', 'messages', 'friend', 'friends', 'room', 'rooms', 'setting', 'settings', 'home', 'feed', 'group', 'groups'];
                if (navCommands.includes(slots.target_name as string)) continue;
            }
            if (rule.intent === 'intent_search_user' && slots.target_name && (slots.target_name as string).includes('group')) {
                continue;
            }
            return { intent: rule.intent, slots: Object.keys(slots).length > 0 ? slots : undefined };
        }
    }
    
    // 2. Check for reactions separately as they can be noisy
    const emojiKey = Object.keys(VOICE_EMOJI_MAP).find(k => lowerCommand.includes(k));
    const reactionKey = ['react', 'reaction', 'dao'].find(k => lowerCommand.includes(k));
    if (emojiKey && reactionKey) {
        if (lowerCommand.includes('last message') || lowerCommand.includes('sesh message')) {
             return { intent: 'intent_react_to_last_message', slots: { emoji_type: emojiKey } };
        }
        const commandWords = lowerCommand.split(' ');
        const isSimpleReaction = commandWords.length <= 3 && commandWords.some(w => Object.keys(VOICE_EMOJI_MAP).includes(w)) && commandWords.some(w => ['react', 'reaction', 'dao'].includes(w));
        if (isSimpleReaction) {
            return { intent: 'intent_react_to_last_message', slots: { emoji_type: emojiKey } };
        }
        return { intent: 'intent_react_to_message', slots: { emoji_type: emojiKey } };
    }


    // 3. Check simple phrase-based commands
    for (const mapping of commandMap) {
        for (const phrase of mapping.phrases) {
            const regex = new RegExp(`^${phrase}$`, 'i');
            if (regex.test(lowerCommand)) {
                return { intent: mapping.intent };
            }
        }
    }
    return null;
}

// In a real app, this would be a full backend. For this demo, it's a mock.
const generateId = () => Math.random().toString(36).substr(2, 9);

const mockDb: {
  users: User[];
  posts: Post[];
  campaigns: Campaign[];
  groups: Group[];
  stories: Story[];
  admins: AdminUser[];
} = {
  users: [],
  posts: [],
  campaigns: [],
  groups: [],
  stories: [],
  admins: [],
};

// --- Mock Service Implementation ---
// This part simulates a backend API for the entire application.
// All functions are added to the exported geminiService object.
const mockApi = {
    // These functions would be implemented in a real backend.
    // We are just providing stubs with Promise.resolve for now.
    async getPendingCampaigns(): Promise<Campaign[]> { return firebaseService.getPendingCampaigns(); },
    async getCampaignsForSponsor(sponsorId: string): Promise<Campaign[]> { return Promise.resolve([]); },
    async submitCampaignForApproval(campaignData: Omit<Campaign, 'id' | 'views' | 'clicks' | 'status' | 'transactionId'>, transactionId: string): Promise<void> {
        return firebaseService.submitCampaignForApproval(campaignData, transactionId);
    },
    async approveCampaign(campaignId: string): Promise<void> { return firebaseService.approveCampaign(campaignId); },
    async rejectCampaign(campaignId: string, reason: string): Promise<void> { return firebaseService.rejectCampaign(campaignId, reason); },
    async getAllUsersForAdmin(): Promise<User[]> { return firebaseService.getAllUsersForAdmin(); },
    async banUser(userId: string): Promise<boolean> { return firebaseService.banUser(userId); },
    async unbanUser(userId: string): Promise<boolean> { return firebaseService.unbanUser(userId); },
    async suspendUserCommenting(userId: string, days: number): Promise<boolean> { return firebaseService.suspendUserCommenting(userId, days); },
    async liftUserCommentingSuspension(userId: string): Promise<boolean> { return firebaseService.liftUserCommentingSuspension(userId); },
    async reactivateUserAsAdmin(userId: string): Promise<boolean> { return Promise.resolve(true); },
    async adminUpdateUserProfilePicture(userId: string, base64: string): Promise<User | null> { return Promise.resolve(null); },
    async getConversations(userId: string): Promise<Conversation[]> { return Promise.resolve([]); },
    async createComment(user: User, postId: string, data: any): Promise<Comment | null> { return Promise.resolve(null); },
    async likePost(postId: string, userId: string): Promise<boolean> { return Promise.resolve(true); },
    async getStories(userId: string): Promise<{ author: User; stories: Story[]; allViewed: boolean; }[]> { return Promise.resolve([]); },
    async getRandomActiveCampaign(): Promise<Campaign | null> { return Promise.resolve(null); },
    async searchUsers(query: string): Promise<User[]> { return Promise.resolve([]); },
    async acceptFriendRequest(currentUserId: string, requestingUserId: string): Promise<void> { 
        return firebaseService.acceptFriendRequest(currentUserId, requestingUserId); 
    },
    async declineFriendRequest(currentUserId: string, requestingUserId: string): Promise<void> { 
        return firebaseService.declineFriendRequest(currentUserId, requestingUserId); 
    },
    async getFriendRequests(userId: string): Promise<User[]> { 
        return firebaseService.getFriendRequests(userId); 
    },
    async getRecommendedFriends(userId: string): Promise<User[]> { return Promise.resolve([]); },
    async getFriendsList(userId: string): Promise<User[]> { return Promise.resolve([]); },
    async addFriend(currentUserId: string, targetUserId: string): Promise<{ success: boolean; reason?: string }> { 
        return firebaseService.addFriend(currentUserId, targetUserId);
    },
    async getMessages(userId1: string, userId2: string): Promise<Message[]> { return Promise.resolve([]); },
    async getChatSettings(userId1: string, userId2: string): Promise<Partial<ChatSettings>> { return Promise.resolve({ theme: 'default' }); },
    async sendAudioMessage(senderId: string, recipientId: string, duration: number, replyTo?: any): Promise<Message> { return Promise.resolve({} as Message); },
    async sendMediaMessage(senderId: string, recipientId: string, mediaUrl: string, type: 'image' | 'video', text?: string, replyTo?: any): Promise<Message> { return Promise.resolve({} as Message); },
    async sendTextMessage(senderId: string, recipientId: string, text: string, replyTo?: any): Promise<Message> { return Promise.resolve({} as Message); },
    async deleteChatHistory(userId1: string, userId2: string): Promise<void> { return Promise.resolve(); },
    async updateChatSettings(userId1: string, userId2: string, settings: Partial<ChatSettings>): Promise<void> { return Promise.resolve(); },
    async reactToMessage(messageId: string, userId: string, emoji: string): Promise<Message | null> { return Promise.resolve(null); },
    createReplySnippet(message: Message): string { return message.text || "Media"; },
    async getPostById(postId: string): Promise<Post | null> { return firebaseService.getPostById(postId); },
    async markBestAnswer(userId: string, postId: string, commentId: string): Promise<Post | null> { 
        return firebaseService.markBestAnswer(userId, postId, commentId);
    },
    async getUserProfile(name: string): Promise<User | null> { return Promise.resolve(null); },
    async getPostsByUser(userId: string): Promise<Post[]> { return Promise.resolve([]); },
    async updateProfile(userId: string, updates: Partial<User>): Promise<void> { return firebaseService.updateProfile(userId, updates); },
    async updateProfilePicture(userId: string, base64Url: string, caption?: string, captionStyle?: Post['captionStyle']): Promise<{ updatedUser: User, newPost: Post } | null> { 
        return firebaseService.updateProfilePicture(userId, base64Url, caption, captionStyle); 
    },
    async updateCoverPhoto(userId: string, base64Url: string, caption?: string, captionStyle?: Post['captionStyle']): Promise<{ updatedUser: User, newPost: Post } | null> { 
        return firebaseService.updateCoverPhoto(userId, base64Url, caption, captionStyle);
    },
    async getUserById(userId: string): Promise<User | null> { return firebaseService.getUserProfileById(userId); },
    async changePassword(userId: string, currentPass: string, newPass: string): Promise<boolean> { return Promise.resolve(true); },
    async updateVoiceCoins(userId: string, amount: number): Promise<boolean> {
        return firebaseService.updateVoiceCoins(userId, amount);
    },
    async getAllPostsForAdmin(): Promise<Post[]> { return firebaseService.getAllPostsForAdmin(); },
    async deletePostAsAdmin(postId: string): Promise<boolean> { return firebaseService.deletePostAsAdmin(postId); },
    async deleteCommentAsAdmin(commentId: string, postId: string): Promise<boolean> { return firebaseService.deleteCommentAsAdmin(commentId, postId); },
    async adminLogin(email: string, pass: string): Promise<AdminUser | null> { return Promise.resolve(null); },
    async adminRegister(email: string, pass: string): Promise<AdminUser | null> { return Promise.resolve(null); },
    async createLiveAudioRoom(host: User, topic: string): Promise<LiveAudioRoom | null> { return Promise.resolve(null); },
    async getAudioRoomDetails(roomId: string): Promise<LiveAudioRoom | null> { return Promise.resolve(null); },
    async joinLiveAudioRoom(userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async leaveLiveAudioRoom(userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    listenToAudioRoom(roomId: string, callback: (room: LiveAudioRoom | null) => void) {
        return firebaseService.listenToRoom(roomId, 'audio', callback as (room: any) => void);
    },
    listenToVideoRoom(roomId: string, callback: (room: LiveVideoRoom | null) => void) {
        return firebaseService.listenToRoom(roomId, 'video', callback as (room: any) => void);
    },
    async endLiveAudioRoom(userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async raiseHandInAudioRoom(userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async inviteToSpeakInAudioRoom(hostId: string, userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async moveToAudienceInAudioRoom(hostId: string, userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async createLiveVideoRoom(host: User, topic: string): Promise<LiveVideoRoom | null> { return Promise.resolve(null); },
    async getVideoRoomDetails(roomId: string): Promise<LiveVideoRoom | null> { return Promise.resolve(null); },
    async joinLiveVideoRoom(userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async leaveLiveVideoRoom(userId: string, roomId: string): Promise<void> { return Promise.resolve(); },
    async getSuggestedGroups(userId: string): Promise<Group[]> { return Promise.resolve([]); },
    async createGroup(creator: User, name: string, description: string, coverPhotoUrl: string, privacy: 'public' | 'private', requiresApproval: boolean, category: GroupCategory): Promise<Group | null> { return Promise.resolve(null); },
    async getGroupById(groupId: string): Promise<Group | null> { return Promise.resolve(null); },
    async getPostsForGroup(groupId: string): Promise<Post[]> { return Promise.resolve([]); },
    async joinGroup(userId: string, groupId: string, answers?: string[]): Promise<boolean> { return Promise.resolve(true); },
    async leaveGroup(userId: string, groupId: string): Promise<boolean> { return Promise.resolve(true); },
    async pinPost(groupId: string, postId: string): Promise<boolean> { return Promise.resolve(true); },
    async unpinPost(groupId: string): Promise<boolean> { return Promise.resolve(true); },
    async voteOnPoll(userId: string, postId: string, optionIndex: number): Promise<Post | null> {
        return firebaseService.voteOnPoll(userId, postId, optionIndex);
    },
    async updateGroupSettings(groupId: string, settings: Partial<Group>): Promise<boolean> { return Promise.resolve(true); },
    async approveJoinRequest(groupId: string, userId: string): Promise<void> { 
        return firebaseService.approveJoinRequest(groupId, userId);
    },
    async rejectJoinRequest(groupId: string, userId: string): Promise<void> { 
        return firebaseService.rejectJoinRequest(groupId, userId);
    },
    async approvePost(postId: string): Promise<void> { 
        return firebaseService.approvePost(postId);
    },
    async rejectPost(postId: string): Promise<void> { 
        return firebaseService.rejectPost(postId);
    },
    async getGroupChat(groupId: string): Promise<GroupChat | null> { return Promise.resolve(null); },
    async sendGroupChatMessage(groupId: string, sender: User, text: string): Promise<any> { return Promise.resolve({}); },
    async getGroupEvents(groupId: string): Promise<Event[]> { return Promise.resolve([]); },
    async rsvpToEvent(userId: string, eventId: string): Promise<boolean> { return Promise.resolve(true); },
    async createGroupEvent(creator: User, groupId: string, title: string, description: string, date: string): Promise<Event | null> { return Promise.resolve(null); },
    async createStory(storyData: any): Promise<Story | null> {
        const { mediaFile, ...restOfData } = storyData;
        try {
            return await firebaseService.createStory(restOfData, mediaFile);
        } catch (error) {
            console.error("Error creating story in service:", error);
            return null;
        }
    },
    async markStoryAsViewed(storyId: string, userId: string): Promise<void> { return Promise.resolve(); },
    async inviteFriendToGroup(groupId: string, friendId: string): Promise<boolean> { return Promise.resolve(true); },
    async updateUserRole(userId: string, newRole: 'admin' | 'user'): Promise<boolean> { return Promise.resolve(true); },
    async removeGroupMember(groupId: string, userToRemove: User): Promise<boolean> {
        return firebaseService.removeGroupMember(groupId, userToRemove);
    },
    async promoteGroupMember(groupId: string, userToPromote: User, newRole: 'Admin' | 'Moderator'): Promise<boolean> {
        return firebaseService.promoteGroupMember(groupId, userToPromote, newRole);
    },
    async demoteGroupMember(groupId: string, userToDemote: User, oldRole: 'Admin' | 'Moderator'): Promise<boolean> {
        return firebaseService.demoteGroupMember(groupId, userToDemote, oldRole);
    },
    async blockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
        return firebaseService.blockUser(currentUserId, targetUserId);
    },
    async unblockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
        return firebaseService.unblockUser(currentUserId, targetUserId);
    },
    async deactivateAccount(userId: string): Promise<boolean> {
        return firebaseService.deactivateAccount(userId);
    },
    async getAdminDashboardStats() {
        return firebaseService.getAdminDashboardStats();
    },
    async updateUserLastActive(userId: string): Promise<void> {
        return firebaseService.updateUserLastActive(userId);
    },
    async getPendingReports(): Promise<Report[]> {
        return firebaseService.getPendingReports();
    },
    async resolveReport(reportId: string, resolution: string): Promise<void> {
        return firebaseService.resolveReport(reportId, resolution);
    },
    async warnUser(userId: string, message: string): Promise<boolean> {
        return firebaseService.warnUser(userId, message);
    },
    async suspendUserPosting(userId: string, days: number): Promise<boolean> {
        return firebaseService.suspendUserPosting(userId, days);
    },
    async liftUserPostingSuspension(userId: string): Promise<boolean> {
        return firebaseService.liftUserPostingSuspension(userId);
    },
    async getUserDetailsForAdmin(userId: string) {
        return firebaseService.getUserDetailsForAdmin(userId);
    },
    async sendSiteWideAnnouncement(message: string): Promise<boolean> {
        return firebaseService.sendSiteWideAnnouncement(message);
    },
    async getAllCampaignsForAdmin(): Promise<Campaign[]> {
        return firebaseService.getAllCampaignsForAdmin();
    },
    async verifyCampaignPayment(campaignId: string, adminId: string): Promise<boolean> {
        return firebaseService.verifyCampaignPayment(campaignId, adminId);
    },
};

export const geminiService = {
    // --- LIVE GEMINI API FUNCTIONS ---

    async processIntent(command: string, context?: { userNames?: string[] }): Promise<NLUResponse> {
        const localResponse = processLocalIntent(command);
        if (localResponse) {
            console.log("Local NLU:", localResponse);
            return Promise.resolve(localResponse);
        }

        console.log("Falling back to Gemini API for NLU...");
        try {
            let dynamicSystemInstruction = NLU_SYSTEM_INSTRUCTION_BASE;
            if (context?.userNames && context.userNames.length > 0) {
                const uniqueNames = [...new Set(context.userNames)];
                dynamicSystemInstruction += `\n\n---\nCONTEXTUAL AWARENESS:\nAvailable names: [${uniqueNames.map(name => `"${name}"`).join(', ')}]`;
            }

            const nluResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: command,
                config: {
                  systemInstruction: dynamicSystemInstruction,
                  responseMimeType: "application/json",
                },
            });

            const text = nluResponse.text.trim();
            const jsonText = text.replace(/^```(json)?/, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(jsonText);
            
            return parsed;

        } catch (error) {
            console.error("Error calling Gemini for intent processing:", error);
            return { intent: 'unknown' };
        }
    },

    async generateImageForPost(prompt: string): Promise<string | null> {
        try {
            const imageResponse = await ai.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: prompt,
                config: {
                  numberOfImages: 1,
                  outputMimeType: 'image/jpeg',
                  aspectRatio: '1:1',
                },
            });
            
            if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
                 const base64ImageBytes: string = imageResponse.generatedImages[0].image.imageBytes;
                 return `data:image/jpeg;base64,${base64ImageBytes}`;
            }
            return null;
        } catch (error) {
            console.error("Error calling Gemini for image generation:", error);
            return null;
        }
    },

    async getCategorizedExploreFeed(currentUserId: string): Promise<CategorizedExploreFeed> {
        // In a real app, this would be a more complex backend process.
        // Here, we'll fetch all public posts and send them to Gemini for categorization.
        const allPublicPosts = await mockApi.getAllPostsForAdmin(); // Using this as a proxy for all posts
        const postsForAnalysis = allPublicPosts
            .filter(p => p.author.id !== currentUserId && p.author.privacySettings?.postVisibility !== 'friends')
            .slice(0, 50); // Limit to 50 for performance

        const postSchema = {
            type: Type.OBJECT,
            properties: {
                id: { type: Type.STRING },
                caption: { type: Type.STRING },
                audioUrl: { type: Type.STRING, nullable: true },
                imageUrl: { type: Type.STRING, nullable: true },
                videoUrl: { type: Type.STRING, nullable: true },
                reactionCount: { type: Type.NUMBER },
                commentCount: { type: Type.NUMBER },
                postType: { type: Type.STRING, nullable: true },
                author: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        name: { type: Type.STRING },
                        avatarUrl: { type: Type.STRING },
                    }
                }
            }
        };

        const systemInstruction = `
            You are a social media content curator. Your task is to analyze a list of posts and categorize them into several feeds based on their content, popularity, and type.
            - 'trending': Posts with high engagement (likes/comments) that are generating buzz.
            - 'forYou': A personalized mix of content that might be interesting based on a variety of signals. Since you don't have user history, select a diverse and engaging set of posts.
            - 'questions': Posts that are explicitly asking a question to the community.
            - 'funnyVoiceNotes': Audio posts that are likely humorous, light-hearted, or entertaining based on their caption.
            - 'newTalent': Posts from authors with fewer posts but high-quality content, representing undiscovered creators.

            Return a single JSON object matching the provided schema. Each category should contain between 3 and 8 posts. A post can appear in multiple categories.
        `;

        try {
             const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Here is the list of posts to categorize: ${JSON.stringify(postsForAnalysis, null, 2)}`,
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            trending: { type: Type.ARRAY, items: postSchema },
                            forYou: { type: Type.ARRAY, items: postSchema },
                            questions: { type: Type.ARRAY, items: postSchema },
                            funnyVoiceNotes: { type: Type.ARRAY, items: postSchema },
                            newTalent: { type: Type.ARRAY, items: postSchema },
                        }
                    },
                },
             });

            const jsonStr = response.text.trim();
            const parsed = JSON.parse(jsonStr) as CategorizedExploreFeed;
            return parsed;
        } catch (error) {
            console.error("Error calling Gemini for explore feed categorization:", error);
            // Fallback to a simple popular sort if AI fails
            return {
                trending: postsForAnalysis.sort((a, b) => (b.reactionCount || 0) - (a.reactionCount || 0)).slice(0, 8),
                forYou: [],
                questions: [],
                funnyVoiceNotes: [],
                newTalent: [],
            };
        }
    },

    // --- MOCK API FUNCTIONS (Using In-Memory Data) ---
    getMusicLibrary(): MusicTrack[] {
        return MOCK_MUSIC_LIBRARY;
    },
    ...mockApi,
    listenToLiveAudioRooms(callback: (rooms: LiveAudioRoom[]) => void) {
        return firebaseService.listenToLiveAudioRooms(callback);
    },
    listenToLiveVideoRooms(callback: (rooms: LiveVideoRoom[]) => void) {
        return firebaseService.listenToLiveVideoRooms(callback);
    },
};