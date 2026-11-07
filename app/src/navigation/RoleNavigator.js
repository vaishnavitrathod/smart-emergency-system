import React from 'react';
import { Pressable, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ContactsScreen from '../screens/ContactsScreen';
import HomeScreen from '../screens/HomeScreen';
import IncidentScreen from '../screens/IncidentScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MyIncidentsScreen from '../screens/student/MyIncidentsScreen';
import GuardHomeScreen from '../screens/guard/GuardHomeScreen';
import GuardIncidentScreen from '../screens/guard/GuardIncidentScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import LocationsScreen from '../screens/admin/LocationsScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import SafeWalkScreen from '../screens/student/SafeWalkScreen';
import FirstAidScreen from '../screens/FirstAidScreen';
import MedicalIdScreen from '../screens/MedicalIdScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const headerStyle = {
  headerStyle: { backgroundColor: colors.red },
  headerTintColor: colors.white,
  headerTitleStyle: { fontWeight: '700' },
};

export default function RoleNavigator({ user, profile, onSignOut }) {
  const role = ({ student: 'user', guard: 'responder' })[profile.role] || profile.role;
  const roleHome = role === 'responder' ? 'GuardHome' : ['admin', 'operator'].includes(role) ? 'AdminDashboard' : 'StudentHome';
  return (
    <Stack.Navigator
      key={roleHome}
      initialRouteName={roleHome}
      screenOptions={({ navigation, route }) => ({
        ...headerStyle,
        headerRight: () =>
          route.name === 'Profile' ? null : (
            <Pressable onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel="Open profile">
              <Text style={{ color: colors.white, fontWeight: '700', paddingHorizontal: 8 }}>Profile</Text>
            </Pressable>
          ),
      })}
    >
      <Stack.Screen name="StudentHome" options={{ title: 'Emergency Response' }}>
        {(props) => <HomeScreen {...props} profile={profile} user={user} />}
      </Stack.Screen>
      <Stack.Screen name="GuardHome" options={{ title: 'Responder Home' }}>
        {(props) => <GuardHomeScreen {...props} user={{ ...profile, role, uid: user.uid }} />}
      </Stack.Screen>
      <Stack.Screen name="GuardIncident" options={{ title: 'Responder Incident' }}>
        {(props) => <GuardIncidentScreen {...props} user={{ ...profile, role, uid: user.uid }} />}
      </Stack.Screen>
      <Stack.Screen name="AdminDashboard" options={{ title: role === 'operator' ? 'Operator Dashboard' : 'Admin Panel' }}>
        {(props) => <AdminDashboardScreen {...props} user={user} profile={profile} readOnly={role === 'operator'} />}
      </Stack.Screen>
      <Stack.Screen name="AdminLocations" component={LocationsScreen} options={{ title: 'Configured locations' }} />
      <Stack.Screen name="Incident" options={{ title: 'Incident' }}>
        {(props) => <IncidentScreen {...props} role={profile.role} />}
      </Stack.Screen>
      <Stack.Screen name="MyIncidents" component={MyIncidentsScreen} options={{ title: 'My Incidents' }} />
      <Stack.Screen name="Contacts" component={ContactsScreen} options={{ title: 'Contacts' }} />
      <Stack.Screen name="Profile" options={{ title: 'Profile' }}>
        {(props) => <ProfileScreen {...props} user={user} profile={profile} onSignOut={onSignOut} />}
      </Stack.Screen>
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy' }} />
      <Stack.Screen name="SafeWalk" options={{ title: 'Safe journey' }}>
        {(props) => <SafeWalkScreen {...props} profile={profile} />}
      </Stack.Screen>
      <Stack.Screen name="FirstAid" options={{ title: 'First Aid' }}>
        {(props) => <FirstAidScreen {...props} profile={profile} />}
      </Stack.Screen>
      <Stack.Screen name="MedicalId" options={{ title: 'Medical ID' }} component={MedicalIdScreen} />
    </Stack.Navigator>
  );
}
