import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatsScreen from '../screens/Chats/ChatsScreen';
import ChatRoomScreen from '../screens/Chats/ChatRoomScreen';

export type ChatsStackParamList = {
  Chats: undefined;
  ChatRoom: { chatId: string };
};

const Stack = createNativeStackNavigator<ChatsStackParamList>();

export default function ChatsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Chats" component={ChatsScreen} />
      <Stack.Screen name="ChatRoom" component={ChatRoomScreen} options={{ title: 'Chat' }} />
    </Stack.Navigator>
  );
}


