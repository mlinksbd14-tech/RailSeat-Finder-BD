/**
 * RailSeat Finder BD - Internationalization (i18n) Engine
 * Full English (EN) & Bengali (বাংলা) Translation, Numeral, and Date Formatting
 */

(function(window) {
  'use strict';

  // ----------------------------------------------------
  // 1. Language State
  // ----------------------------------------------------
  const DEFAULT_LANG = 'bn'; // Default to Bangla for BD users
  let currentLang = localStorage.getItem('rail_lang') || DEFAULT_LANG;

  // ----------------------------------------------------
  // 2. Bilingual Dictionaries
  // ----------------------------------------------------
  const translations = {
    en: {
      // Header & Brand
      app_title: 'RailSeat BD',
      app_tagline: 'Bangladesh Railway Seat Availability & Radar',
      live_status: 'Live',
      connect_live_api: 'Connect Live API',
      install_app: 'Install App',
      sign_in: 'Sign In',
      logout: 'Sign Out / Logout',
      manage_users: 'Manage Users',
      help_support: 'Help & Live Support',
      admin_analytics: 'Analytics',

      // Navigation
      nav_seat_finder: 'Seat Finder',
      nav_live_radar: 'Live Radar',
      nav_routes: 'Routes',
      nav_watchlist: 'Watchlist',
      nav_alerts: 'Alerts',
      nav_settings: 'Settings',

      // Hero Search Card
      search_hero_title: 'Find Bangladesh Railway Seats',
      search_hero_badge: 'Live Gateway',
      search_hero_desc: 'Real-time vacant seats, train schedules, fares & 24/7 radar alerts.',
      from_station: 'From Station',
      from_placeholder: 'Departure (e.g. Dhaka)',
      to_station: 'Destination',
      to_placeholder: 'Arrival (e.g. Chattogram)',
      swap_stations: 'Swap Stations',
      journey_date: 'Journey Date',
      find_trains: 'Find Trains',
      deep_search: 'Deep Search',
      quick_date: 'Quick Date:',
      today: 'Today',
      tomorrow: 'Tomorrow',
      ten_day_matrix: '10-Day Matrix',
      filter_train: 'Train:',
      all_trains: 'All Trains',
      filter_class: 'Class:',
      all_classes: 'All Classes',

      // Seat Classes (Same as Shohoz Server)
      class_s_chair: 'S_CHAIR',
      class_snigdha: 'SNIGDHA',
      class_ac_s: 'AC_S',
      class_ac_b: 'AC_B',
      class_shovon: 'SHOVAN',
      class_sulob: 'SULOB',
      class_f_berth: 'F_BERTH',
      class_f_seat: 'F_SEAT',
      class_f_chair: 'F_CHAIR',
      class_ac_chair: 'AC_CHAIR',
      class_ac_c: 'AC_C',

      // Seat Availability Badges
      seats_available: 'Available',
      sold_out: 'Sold Out',
      seats_count: 'seats',
      online_seats: 'Online',
      counter_seats: 'Counter',
      fare_label: 'Fare',
      book_on_shohoz: 'Book on Shohoz',
      book_now: 'Book Now',
      travel_time: 'Travel Time',
      off_day: 'Off Day',
      no_trains_found: 'No trains found for this route and date.',
      please_select_stations: 'Please select both departure and arrival stations.',

      // Live Radar & Watchlist
      radar_title: 'Live Train Radar',
      watchlist_title: 'Seat Watchlist & Radar',
      watchlist_add_btn: 'Add to Watchlist',
      watchlist_empty: 'Your watchlist is empty. Add a route to monitor seat releases 24/7.',
      refresh: 'Refresh',
      close: 'Close',

      // Modals
      route_explorer_title: 'Train Route & Stoppages',
      station_matrix_title: 'All-Stoppage Seat Matrix',
      settings_title: 'Settings & Preferences'
    },

    bn: {
      // Header & Brand
      app_title: 'রেলসিট বিডি',
      app_tagline: 'বাংলাদেশ রেলওয়ের রিয়েল-টাইম সিট ও ট্রেন ট্র্যাকার',
      live_status: 'সরাসরি',
      connect_live_api: 'লাইভ API কানেক্ট',
      install_app: 'অ্যাপ ইনস্টল করুন',
      sign_in: 'লগইন করুন',
      logout: 'লগআউট করুন',
      manage_users: 'ইউজার ম্যানেজমেন্ট',
      help_support: 'সাহায্য ও সাপোর্ট',
      admin_analytics: 'অ্যানালিটিক্স',

      // Navigation
      nav_seat_finder: 'সিট খুঁজুন',
      nav_live_radar: 'লাইভ রাডার',
      nav_routes: 'রুটসমূহ',
      nav_watchlist: 'ওয়াচলিস্ট',
      nav_alerts: 'অ্যালার্ট',
      nav_settings: 'সেটিংস',

      // Hero Search Card
      search_hero_title: 'বাংলাদেশ রেলওয়ের সিট খুঁজুন',
      search_hero_badge: 'সরাসরি গেটওয়ে',
      search_hero_desc: 'রিয়েল-টাইম খালি সিট, ট্রেনের সময়সূচি, ভাড়া ও ২৪/৭ রাডার অ্যালার্ট।',
      from_station: 'From',
      from_placeholder: 'Departure (e.g. Dhaka)',
      to_station: 'To',
      to_placeholder: 'Arrival (e.g. Chattogram)',
      swap_stations: 'স্টেশন অদলবদল',
      journey_date: 'ভ্রমণের তারিখ',
      find_trains: 'ট্রেন খুঁজুন',
      deep_search: 'ডিপ সার্চ',
      quick_date: 'দ্রুত তারিখ:',
      today: 'আজ',
      tomorrow: 'আগামীকাল',
      ten_day_matrix: '১০-দিনের ম্যাট্রিক্স',
      filter_train: 'ট্রেন:',
      all_trains: 'সব ট্রেন',
      filter_class: 'শ্রেণি:',
      all_classes: 'সব শ্রেণি',

      // Seat Classes (Same as Shohoz Server)
      class_s_chair: 'S_CHAIR',
      class_snigdha: 'SNIGDHA',
      class_ac_s: 'AC_S',
      class_ac_b: 'AC_B',
      class_shovon: 'SHOVAN',
      class_sulob: 'SULOB',
      class_f_berth: 'F_BERTH',
      class_f_seat: 'F_SEAT',
      class_f_chair: 'F_CHAIR',
      class_ac_chair: 'AC_CHAIR',
      class_ac_c: 'AC_C',

      // Seat Availability Badges
      seats_available: 'উপলব্ধ',
      sold_out: 'বুকড / শেষ',
      seats_count: 'টি সিট',
      online_seats: 'অনলাইন',
      counter_seats: 'কাউন্টার',
      fare_label: 'ভাড়া',
      book_on_shohoz: 'সহজে টিকিট কাটুন',
      book_now: 'টিকিট কাটুন',
      travel_time: 'ভ্রমণ সময়',
      off_day: 'ছুটির দিন',
      no_trains_found: 'এই রুট ও তারিখে কোনো ট্রেন পাওয়া যায়নি।',
      please_select_stations: 'অনুগ্রহ করে ছাড়ার এবং গন্তব্য স্টেশন নির্বাচন করুন।',

      // Live Radar & Watchlist
      radar_title: 'লাইভ ট্রেন রাডার',
      watchlist_title: 'সিট ওয়াচলিস্ট ও রাডার',
      watchlist_add_btn: 'ওয়াচলিস্টে যোগ করুন',
      watchlist_empty: 'আপনার ওয়াচলিস্ট খালি। ২৪/৭ সিট পর্যবেক্ষণের জন্য একটি রুট যোগ করুন।',
      refresh: 'রিফ্রেশ',
      close: 'বন্ধ করুন',

      // Modals
      route_explorer_title: 'ট্রেন রুট ও স্টপেজ তালিকা',
      station_matrix_title: 'সব স্টপেজের সিট ম্যাট্রিক্স',
      settings_title: 'সেটিংস ও পছন্দসমূহ'
    }
  };

  // ----------------------------------------------------
  // 3. Official Station Name Bilingual Dictionary
  // ----------------------------------------------------
  const stationTranslations = {
    'Dhaka': 'ঢাকা (কমলাপুর)',
    'Dhaka Cantonment': 'ঢাকা ক্যান্টনমেন্ট',
    'Biman Bandar': 'বিমানবন্দর',
    'Chattogram': 'চট্টগ্রাম',
    "Cox's Bazar": 'কক্সবাজার',
    'Sylhet': 'সিলেট',
    'Rajshahi': 'রাজশাহী',
    'Khulna': 'খুলনা',
    'Rangpur': 'রংপুর',
    'Bogura': 'বগুড়া',
    'Bogra': 'বগুড়া',
    'Cumilla': 'কুমিল্লা',
    'Comilla': 'কুমিল্লা',
    'Mymensingh': 'ময়মনসিংহ',
    'Benapole': 'বেনাপোল',
    'Ishwardi': 'ঈশ্বরদী',
    'Ishurdi': 'ঈশ্বরদী',
    'Ishurdi Bypass': 'ঈশ্বরদী বাইপাস',
    'Akhaura': 'আখাউড়া',
    'Bhairab Bazar': 'ভৈরব বাজার',
    'Brahmanbaria': 'ব্রাহ্মণবাড়িয়া',
    'Feni': 'ফেনী',
    'Kishoreganj': 'কিশোরগঞ্জ',
    'Netrokona': 'নেত্রকোণা',
    'Jamalpur': 'জামালপুর',
    'Jamalpur Town': 'জামালপুর টাউন',
    'Dewanganj Bazar': 'দেওয়ানগঞ্জ বাজার',
    'Tarakandi': 'তারাকান্দি',
    'Tangail': 'টাঙ্গাইল',
    'Bangabandhu Hi-Tech City': 'বঙ্গবন্ধু হাই-টেক সিটি',
    'Joydebpur': 'জয়দেবপুর',
    'Tongi': 'টঙ্গী',
    'Narsingdi': 'নরসিংদী',
    'Gafargaon': 'গফরগাঁও',
    'Santahar': 'সান্তাহার',
    'Natore': 'নাটোর',
    'Sirajganj': 'সিরাজগঞ্জ',
    'Sirajganj Bazar': 'সিরাজগঞ্জ বাজার',
    'Pabna': 'পাবনা',
    'Kushtia': 'কুষ্টিয়া',
    'Kushtia Court': 'কুষ্টিয়া কোর্ট',
    'Poradah': 'পোড়াদহ',
    'Chuadanga': 'চুয়াডাঙ্গা',
    'Jashore': 'যশোর',
    'Jessore': 'যশোর',
    'Noapara': 'নওয়াপাড়া',
    'Mongla': 'মোংলা',
    'Satkhira': 'সাতক্ষীরা',
    'Gaibandha': 'গাইবান্ধা',
    'Bonarpara': 'বোনারপাড়া',
    'Lalmonirhat': 'লালমনিরহাট',
    'Kurigram': 'কুড়িগ্রাম',
    'Saidpur': 'সৈয়দপুর',
    'Dinajpur': 'দিনাজপুর',
    'Parbatipur': 'পার্বতীপুর',
    'Panchagarh': 'পঞ্চগড়',
    'Bir Muktijoddha Sirajul Islam': 'বীর মুক্তিযোদ্ধা সিরাজুল ইসলাম (পঞ্চগড়)',
    'Chilahati': 'চিলাহাটি',
    'Thakurgaon Road': 'ঠাকুরগাঁও রোড',
    'Shantahar': 'সান্তাহার',
    'Chapainawabganj': 'চাঁপাইনবাবগঞ্জ',
    'Rohanpur': 'রহনপুর',
    'Sreemangal': 'শ্রীমঙ্গল',
    'Kulaura': 'কুলাউড়া',
    'Maijgaon': 'মাইজগাঁও',
    'Shayestaganj': 'শায়েস্তাগঞ্জ',
    'Habiganj': 'হবিগঞ্জ',
    'Chandpur': 'চাঁদপুর',
    'Noakhali': 'নোয়াখালী',
    'Chowmuhani': 'চৌমুহনী',
    'Laksham': 'লাকসাম',
    'Laksam': 'লাকসাম',
    'Gunabati': 'গুণবতী',
    'Faujdarhat': 'ফৌজদারহাট',
    'Sitakunda': 'সীতাকুণ্ড',
    'Mirsharai': 'মীরসরাই',
    'Dohazari': 'দোহাজারী',
    'Satkania': 'সাতকানিয়া',
    'Chakaria': 'চকোরিয়া',
    'Ramu': 'রামু',
    'Faridpur': 'ফরিদপুর',
    'Rajbari': 'রাজবাড়ী',
    'Goalundo Ghat': 'গোয়ালন্দ ঘাট',
    'Bhanga': 'ভাঙ্গা',
    'Bhanga Junction': 'ভাঙ্গা জংশন',
    'Padma': 'পদ্মা',
    'Mawa': 'মাওয়া',
    'Jajira': 'জাজিরা',
    'Shibchar': 'শিবচর',
    'Madaripur': 'মাদারীপুর',
    'Gopalganj': 'গোপালগঞ্জ',
    'Kashiani': 'কাশিয়ানী',
    'Khilgaon': 'খিলগাঁও',
    'Burimari': 'বুড়িমারী'
  };

  // Reverse mapping (Bengali -> English)
  const bnToEnStation = {};
  Object.keys(stationTranslations).forEach(en => {
    bnToEnStation[stationTranslations[en]] = en;
  });

  // ----------------------------------------------------
  // 4. Numeral & Date Converters
  // ----------------------------------------------------
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const bnMonths = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  const bnDays = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

  function toBnNum(num) {
    if (num === null || num === undefined) return '';
    return String(num).replace(/[0-9]/g, d => bnDigits[d]);
  }

  function toEnNum(str) {
    if (!str) return '';
    return String(str).replace(/[০-৯]/g, d => bnDigits.indexOf(d));
  }

  function formatDisplayDate(dateStr, lang = currentLang) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    if (lang === 'bn') {
      const day = toBnNum(date.getDate());
      const month = bnMonths[date.getMonth()];
      const year = toBnNum(date.getFullYear());
      const dayName = bnDays[date.getDay()];
      return `${day} ${month}, ${year} (${dayName})`;
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  }

  function formatDisplayTime(timeStr, lang = currentLang) {
    if (!timeStr) return '';
    if (lang === 'bn') {
      return toBnNum(timeStr);
    }
    return timeStr;
  }

  // ----------------------------------------------------
  // 5. Translation Helper Functions
  // ----------------------------------------------------
  function t(key, fallback = '') {
    const langDict = translations[currentLang] || translations.en;
    return langDict[key] || translations.en[key] || fallback || key;
  }

  function getStationName(station, lang = currentLang) {
    if (!station) return '';
    const trimmed = String(station).trim();
    // Keep Origin, Destination and station names strictly in English even in Bangla mode
    return bnToEnStation[trimmed] || trimmed;
  }

  function getSeatClassName(classCode) {
    if (!classCode) return '';
    const code = String(classCode).trim().toUpperCase();
    const map = {
      'S_CHAIR': 'S_CHAIR',
      'SNIGDHA': 'SNIGDHA',
      'AC_S': 'AC_S',
      'AC_B': 'AC_B',
      'SHOVAN': 'SHOVAN',
      'SHOVON': 'SHOVAN',
      'SULOB': 'SULOB',
      'F_BERTH': 'F_BERTH',
      'F_SEAT': 'F_SEAT',
      'F_CHAIR': 'F_CHAIR',
      'AC_CHAIR': 'AC_CHAIR',
      'AC_C': 'AC_C'
    };
    return map[code] || code;
  }

  // ----------------------------------------------------
  // 6. DOM Text Replacement & Dynamic Update
  // ----------------------------------------------------
  function applyLanguage(lang) {
    currentLang = lang === 'en' ? 'en' : 'bn';
    localStorage.setItem('rail_lang', currentLang);

    document.documentElement.lang = currentLang;
    if (currentLang === 'bn') {
      document.documentElement.classList.add('font-bengali');
    } else {
      document.documentElement.classList.remove('font-bengali');
    }

    // Update static elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && translations[currentLang][key]) {
        el.textContent = translations[currentLang][key];
      }
    });

    // Update static placeholder inputs with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && translations[currentLang][key]) {
        el.placeholder = translations[currentLang][key];
      }
    });

    // Update active button state on language switcher pills
    const toggleBtns = document.querySelectorAll('.lang-toggle-btn');
    toggleBtns.forEach(btn => {
      const targetLang = btn.getAttribute('data-lang');
      if (targetLang === currentLang) {
        btn.classList.add('bg-white', 'dark:bg-slate-700', 'text-emerald-600', 'dark:text-emerald-400', 'shadow-xs');
        btn.classList.remove('text-slate-500', 'dark:text-slate-400');
      } else {
        btn.classList.remove('bg-white', 'dark:bg-slate-700', 'text-emerald-600', 'dark:text-emerald-400', 'shadow-xs');
        btn.classList.add('text-slate-500', 'dark:text-slate-400');
      }
    });

    // Dispatch custom event for dynamic components (search results, matrix, etc.)
    window.dispatchEvent(new CustomEvent('rail_language_changed', { detail: { lang: currentLang } }));
  }

  // Export to Global Scope
  window.i18n = {
    t,
    getLang: () => currentLang,
    setLang: applyLanguage,
    toBnNum,
    toEnNum,
    formatDate: formatDisplayDate,
    formatTime: formatDisplayTime,
    getStationName,
    getSeatClassName,
    stationsMap: stationTranslations,
    reverseStationsMap: bnToEnStation
  };

  // Run initial translation when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyLanguage(currentLang));
  } else {
    applyLanguage(currentLang);
  }

})(window);
