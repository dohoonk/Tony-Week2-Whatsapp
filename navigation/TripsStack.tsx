import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TripsScreen from '../screens/Trips/TripsScreen';
import TripPlannerScreen from '../screens/Trips/TripPlannerScreen';

export type TripsStackParamList = {
  TripsHome: undefined;
  TripPlanner: { chatId: string } | undefined;
};

const Stack = createNativeStackNavigator<TripsStackParamList>();

export default function TripsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="TripsHome" component={TripsScreen} options={{ title: 'Trips' }} />
      <Stack.Screen name="TripPlanner" component={TripPlannerScreen} options={{ title: 'Trip Planner' }} />
    </Stack.Navigator>
  );
}


