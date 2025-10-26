import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import ChatsStack from './ChatsStack';
import TripsStack from './TripsStack';
import FriendsScreen from '../screens/Friends/FriendsScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';
import TripsScreen from '../screens/Trips/TripsScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Chats"
      screenOptions={({ route }) => ({
        headerTitleAlign: 'center',
        tabBarIcon: ({ color, size, focused }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'chatbubbles-outline';
          if (route.name === 'Chats') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Trips') {
            iconName = focused ? 'airplane' : 'airplane-outline';
          } else if (route.name === 'Friends') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Chats" component={ChatsStack} options={{ headerShown: false }} />
      <Tab.Screen
        name="Trips"
        component={TripsStack}
        options={{ headerShown: false }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            // Always land on TripsHome when tapping the tab
            // @ts-ignore
            navigation.navigate('Trips', { screen: 'TripsHome' });
          },
        })}
      />
      <Tab.Screen name="Friends" component={FriendsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}


