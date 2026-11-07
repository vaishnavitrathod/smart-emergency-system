import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '../config';

export const LANGUAGE_NAMES = { en: 'English', hi: 'हिन्दी' };

const STRINGS = {
  en: {
    appTitle: 'Emergency Response',
    sosInstructions: 'Tap for a 3-second countdown. Hold SOS for 2 seconds for silent SOS.',
    dictationHint: 'Voice dictation is not enabled in this build; type a brief description.',
    whereAreYou: 'Where are you?',
    addressPlaceholder: 'Street, area, city',
    sendSosAddress: 'Send SOS with this address',
    localResponse: 'Call local response line',
    emergencyNumberMissing: 'Emergency number not configured',
    safeJourneyTitle: 'Safe journey',
    safeJourneyIntro: 'Share your location while travelling. If you miss your check-in, responders and your saved contacts can be alerted.',
    chooseDuration: 'Choose duration',
    optionalDestination: 'Optional destination',
    destinationPlaceholder: 'Address or destination name',
    startSafeJourney: 'Start safe journey',
    firstAidEnglish: 'First-aid guidance is currently available in English.',
    emailDomainNote: 'Anyone can create a user account with an email address.',
    fullName: 'Full name',
    emailAddress: 'Email address',
    phoneCountry: 'Phone number (optional, include country code)',
    passwordLength: 'Password (at least 8 characters)',
    emergencyNotice: 'This app supports, but does not replace, official emergency services. In a life-threatening emergency call',
    callEmergency: 'Call emergency services',
    sos: 'SOS',
    sendSos: 'Send SOS emergency alert',
    countdown: 'Tap to cancel',
    pressOrHold: 'Press or hold',
    description: 'Describe what is happening (optional)',
    category: 'Emergency category',
    anonymous: 'Anonymous report (your identity is hidden from responders)',
    contacts: 'Contacts',
    myIncidents: 'My incidents',
    safeJourney: 'Start a safe-journey timer',
    firstAid: 'First-aid guidance',
    profile: 'Profile',
    language: 'Language',
    saveProfile: 'Save profile',
    account: 'Create an account',
    anyEmail: 'Anyone can create a user account with an email address.',
    createAccount: 'Create account',
    signOut: 'Sign out',
  },
  hi: {
    appTitle: 'आपातकालीन सहायता',
    sosInstructions: 'तीन सेकंड की उलटी गिनती के लिए टैप करें। बिना आवाज़ SOS भेजने के लिए दो सेकंड दबाकर रखें।',
    dictationHint: 'इस संस्करण में आवाज़ से लिखना उपलब्ध नहीं है; छोटा विवरण टाइप करें।',
    whereAreYou: 'आप कहाँ हैं?',
    addressPlaceholder: 'सड़क, इलाका, शहर',
    sendSosAddress: 'इस पते के साथ SOS भेजें',
    localResponse: 'स्थानीय सहायता नंबर पर कॉल करें',
    emergencyNumberMissing: 'आपातकालीन नंबर सेट नहीं है',
    safeJourneyTitle: 'सुरक्षित यात्रा',
    safeJourneyIntro: 'यात्रा के दौरान अपना स्थान साझा करें। चेक-इन छूटने पर सहायता दल और आपके सहेजे संपर्कों को सूचना दी जा सकती है।',
    chooseDuration: 'अवधि चुनें',
    optionalDestination: 'वैकल्पिक गंतव्य',
    destinationPlaceholder: 'पता या गंतव्य का नाम',
    startSafeJourney: 'सुरक्षित यात्रा शुरू करें',
    firstAidEnglish: 'प्राथमिक उपचार की जानकारी अभी अंग्रेज़ी में उपलब्ध है।',
    emailDomainNote: 'ईमेल पते से कोई भी उपयोगकर्ता खाता बना सकता है।',
    fullName: 'पूरा नाम',
    emailAddress: 'ईमेल पता',
    phoneCountry: 'फोन नंबर (वैकल्पिक, देश कोड सहित)',
    passwordLength: 'पासवर्ड (कम से कम 8 अक्षर)',
    emergencyNotice: 'यह ऐप आधिकारिक आपातकालीन सेवाओं का समर्थन करता है, उनका विकल्प नहीं है। जानलेवा आपात स्थिति में कॉल करें',
    callEmergency: 'आपातकालीन सेवाओं को कॉल करें',
    sos: 'SOS',
    sendSos: 'आपातकालीन SOS भेजें',
    countdown: 'रद्द करने के लिए टैप करें',
    pressOrHold: 'दबाएँ या दबाकर रखें',
    description: 'क्या हो रहा है बताएं (वैकल्पिक)',
    category: 'आपात स्थिति का प्रकार',
    anonymous: 'गुमनाम रिपोर्ट (आपकी पहचान responders से छिपी रहेगी)',
    contacts: 'संपर्क',
    myIncidents: 'मेरी घटनाएँ',
    safeJourney: 'सुरक्षित यात्रा टाइमर शुरू करें',
    firstAid: 'प्राथमिक उपचार मार्गदर्शन',
    profile: 'प्रोफ़ाइल',
    language: 'भाषा',
    saveProfile: 'प्रोफ़ाइल सहेजें',
    account: 'खाता बनाएँ',
    anyEmail: 'कोई भी व्यक्ति ईमेल पते से उपयोगकर्ता खाता बना सकता है।',
    createAccount: 'खाता बनाएँ',
    signOut: 'साइन आउट',
  },
};

const CATEGORY_LABELS = {
  hi: {
    Auto: 'स्वचालित', Medical: 'चिकित्सा', Fire: 'आग', 'Crime/Safety': 'अपराध/सुरक्षा',
    Accident: 'दुर्घटना', Harassment: 'उत्पीड़न', 'Natural hazard': 'प्राकृतिक आपदा', Other: 'अन्य',
  },
};

export function supportedLanguageOptions() {
  const configured = SUPPORTED_LANGUAGES.length ? SUPPORTED_LANGUAGES : [DEFAULT_LANGUAGE];
  return [...new Set(configured)].map((code) => ({ code, name: LANGUAGE_NAMES[code] || code.toUpperCase() }));
}

export function translate(key, language = DEFAULT_LANGUAGE) {
  return STRINGS[language]?.[key] || STRINGS.en[key] || key;
}

export function translateCategory(category, language = DEFAULT_LANGUAGE) {
  return CATEGORY_LABELS[language]?.[category] || category;
}
