/**
 * Bangladesh Railway (Shohoz) Real-Time Seat Availability Dashboard
 * 100% Live API Gateway with Persistent Session Storage & Auto-Expiry Detection
 */

document.addEventListener('DOMContentLoaded', () => {
  // ----------------------------------------------------
  // Application State
  // ----------------------------------------------------
  const state = {
    stations: [],
    selectedFrom: '',
    selectedTo: '',
    selectedDate: '',
    selectedTrain: 'ALL',
    selectedClass: 'ALL',
    viewMode: 'grid', // 'grid' | 'table' | 'matrix'
    pollingInterval: localStorage.getItem('rail_polling_interval') !== null ? parseInt(localStorage.getItem('rail_polling_interval'), 10) : 30, // seconds (0 = off)
    pollingTimer: null,
    isSoundEnabled: localStorage.getItem('rail_sound') !== 'false',
    lastSearchData: null,
    multiDateData: null,
    matrixDays: 7,
    matrixStartDate: '',
    isMatrixLoading: false,
    isMonitorPaused: false,
    monitorCountdown: 30,
    countdownTimer: null,
    watchlist: [],
    pendingWatchTarget: null,
    previousSeatCounts: new Map(),
    notifications: [],
    trainsCatalog: [],
    isLoading: false,
    isAuthenticated: false,
    authUserData: null,
    requireLogin: true,
    requireAdminApproval: false,
    allowRegistration: true,
    liveTrackerTrains: [],
    liveTrackerFilter: 'all',
    liveSearchMode: 'train',
    liveTrackerSearchQuery: '',
    liveRouteFrom: '',
    liveRouteTo: '',
    liveTrackerTimer: null,
    activeMainTab: 'seats',
    authNotice: '',
    authNoticeEnabled: true,
    popularRoutes: [
      { from: 'Dhaka', to: 'Chattogram', label: 'Dhaka ⇄ Ctg' },
      { from: 'Dhaka', to: "Cox's Bazar", label: "Dhaka ⇄ Cox's Bazar" },
      { from: 'Dhaka', to: 'Sylhet', label: 'Dhaka ⇄ Sylhet' },
      { from: 'Dhaka', to: 'Rajshahi', label: 'Dhaka ⇄ Rajshahi' },
      { from: 'Dhaka', to: 'Khulna', label: 'Dhaka ⇄ Khulna' },
      { from: 'Dhaka', to: 'Rangpur', label: 'Dhaka ⇄ Rangpur' }
    ]
  };

  // Load stored custom popular routes from localStorage
  try {
    const savedRoutes = localStorage.getItem('rail_custom_popular_routes');
    if (savedRoutes) {
      const parsed = JSON.parse(savedRoutes);
      if (Array.isArray(parsed) && parsed.length > 0) state.popularRoutes = parsed;
    }
  } catch (e) {}

  // Load stored alert notifications from localStorage
  try {
    const savedNotifs = localStorage.getItem('railway_stored_alerts');
    if (savedNotifs) state.notifications = JSON.parse(savedNotifs);
  } catch (e) {
    state.notifications = [];
  }

  // Load stored watchlist from localStorage
  try {
    const savedWatchlist = localStorage.getItem('railway_watchlist');
    if (savedWatchlist) state.watchlist = JSON.parse(savedWatchlist);
  } catch (e) {
    state.watchlist = [];
  }

  // Universal Bengali locale detection helper to prevent ReferenceError
  const isBnLocale = () => !!(window.i18n && window.i18n.getLang() === 'bn');
  try {
    Object.defineProperty(window, 'isBn', {
      get() {
        return !!(window.i18n && window.i18n.getLang() === 'bn');
      },
      configurable: true
    });
  } catch (e) {}

  // ----------------------------------------------------
  // DOM Elements
  // ----------------------------------------------------
  const searchForm = document.getElementById('searchForm');
  const fromStationInput = document.getElementById('fromStationInput');
  const toStationInput = document.getElementById('toStationInput');
  const fromDropdown = document.getElementById('fromDropdown');
  const toDropdown = document.getElementById('toDropdown');
  const clearFromBtn = document.getElementById('clearFromBtn');
  const clearToBtn = document.getElementById('clearToBtn');
  const swapStationsBtn = document.getElementById('swapStationsBtn');
  const swapIcon = document.getElementById('swapIcon');
  const journeyDateInput = document.getElementById('journeyDateInput');
  const dateChipsContainer = document.getElementById('dateChipsContainer');
  const trainFilterSelect = document.getElementById('trainFilterSelect');
  const classFilterSelect = document.getElementById('classFilterSelect');
  const searchSubmitBtn = document.getElementById('searchSubmitBtn');
  const deepSearchSubmitBtn = document.getElementById('deepSearchSubmitBtn');
  
  const trackerBar = document.getElementById('trackerBar');
  const activeFromBadge = document.getElementById('activeFromBadge');
  const activeToBadge = document.getElementById('activeToBadge');
  const activeDateBadge = document.getElementById('activeDateBadge');
  const lastUpdatedTime = document.getElementById('lastUpdatedTime');
  const pollingIntervalSelect = document.getElementById('pollingIntervalSelect');
  const pollingIndicator = document.getElementById('pollingIndicator');
  const manualRefreshBtn = document.getElementById('manualRefreshBtn');
  const refreshIcon = document.getElementById('refreshIcon');
  
  const viewGridBtn = document.getElementById('viewGridBtn');
  const viewTableBtn = document.getElementById('viewTableBtn');
  const viewMatrixBtn = document.getElementById('viewMatrixBtn');
  const quickMatrixViewBtn = document.getElementById('quickMatrixViewBtn');
  const trainsGrid = document.getElementById('trainsGrid');
  const trainsTableView = document.getElementById('trainsTableView');
  const trainsMatrixView = document.getElementById('trainsMatrixView');
  const matrixContentContainer = document.getElementById('matrixContentContainer');
  const matrixStartDateInput = document.getElementById('matrixStartDateInput');
  const matrixDaysPresetGroup = document.getElementById('matrixDaysPresetGroup');
  const matrixCustomDaysInput = document.getElementById('matrixCustomDaysInput');
  const matrixRefreshBtn = document.getElementById('matrixRefreshBtn');
  const calendarMatrixTitle = document.getElementById('calendarMatrixTitle');
  const tableBody = document.getElementById('tableBody');
  
  const statsRibbon = document.getElementById('statsRibbon');
  const statTotalTrains = document.getElementById('statTotalTrains');
  const statOnlineSeats = document.getElementById('statOnlineSeats');
  const statCounterSeats = document.getElementById('statCounterSeats');
  const statCombinedSeats = document.getElementById('statCombinedSeats');
  
  const initialStateCard = document.getElementById('initialStateCard');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const noticeBanner = document.getElementById('noticeBanner');
  const noticeText = document.getElementById('noticeText');
  const bannerConnectBtn = document.getElementById('bannerConnectBtn');
  const searchModeBadge = document.getElementById('searchModeBadge');
  const toastContainer = document.getElementById('toastContainer');
  const liveBadge = document.getElementById('liveBadge');

  // Auto-Monitor Countdown & Pause/Resume Elements
  const monitorTickerContainer = document.getElementById('monitorTickerContainer');
  const monitorCountdownLabel = document.getElementById('monitorCountdownLabel');
  const monitorProgressBar = document.getElementById('monitorProgressBar');
  const monitorPauseResumeBtn = document.getElementById('monitorPauseResumeBtn');
  const monitorPauseIcon = document.getElementById('monitorPauseIcon');

  // Share Modal Elements
  const shareResultsBtn = document.getElementById('shareResultsBtn');
  const shareModal = document.getElementById('shareModal');
  const shareCloseBtn = document.getElementById('shareCloseBtn');
  const sharePreviewTextarea = document.getElementById('sharePreviewTextarea');
  const copyShareSummaryBtn = document.getElementById('copyShareSummaryBtn');
  const whatsappShareBtn = document.getElementById('whatsappShareBtn');

  // Watchlist Elements
  const openWatchlistBtn = document.getElementById('openWatchlistBtn');
  const watchlistBadge = document.getElementById('watchlistBadge');
  const radarUserBadge = document.getElementById('radarUserBadge');
  const watchlistModal = document.getElementById('watchlistModal');
  const watchlistCloseBtn = document.getElementById('watchlistCloseBtn');
  const watchlistItemsContainer = document.getElementById('watchlistItemsContainer');
  const clearWatchlistBtn = document.getElementById('clearWatchlistBtn');

  // Telegram 1-Click Login & Alert Elements
  const telegramStatusBadge = document.getElementById('telegramStatusBadge');
  const telegramDisconnectedCard = document.getElementById('telegramDisconnectedCard');
  const telegramConnectedCard = document.getElementById('telegramConnectedCard');
  const telegramLoginBtn = document.getElementById('telegramLoginBtn');
  const telegramPairCodeDisplay = document.getElementById('telegramPairCodeDisplay');
  const telegramPairingSpinner = document.getElementById('telegramPairingSpinner');
  const telegramQuickCheckBtn = document.getElementById('telegramQuickCheckBtn');
  const telegramManualChatId = document.getElementById('telegramManualChatId');
  const telegramManualSaveBtn = document.getElementById('telegramManualSaveBtn');
  const telegramConnectedUserLabel = document.getElementById('telegramConnectedUserLabel');
  const telegramConnectedChatIdBadge = document.getElementById('telegramConnectedChatIdBadge');
  const telegramSendTestAlertBtn = document.getElementById('telegramSendTestAlertBtn');
  const telegramDisconnectBtn = document.getElementById('telegramDisconnectBtn');
  const telegramSetupStatus = document.getElementById('telegramSetupStatus');

  // Set Watch Target Modal Elements
  const setWatchTargetModal = document.getElementById('setWatchTargetModal');
  const setWatchCloseBtn = document.getElementById('setWatchCloseBtn');
  const watchTargetTrainName = document.getElementById('watchTargetTrainName');
  const watchTargetRouteDate = document.getElementById('watchTargetRouteDate');
  const watchTargetClassSelect = document.getElementById('watchTargetClassSelect');
  const watchMultiDateGrid = document.getElementById('watchMultiDateGrid');
  const watchSelectedDatesCount = document.getElementById('watchSelectedDatesCount');
  const watchSelectAdvanceDatesBtn = document.getElementById('watchSelectAdvanceDatesBtn');
  const watchSelectAllDatesBtn = document.getElementById('watchSelectAllDatesBtn');
  const watchResetTodayDateBtn = document.getElementById('watchResetTodayDateBtn');
  const saveWatchTargetBtn = document.getElementById('saveWatchTargetBtn');

  // Intermediate Stoppage Calculator Elements
  const routeCalcFromSelect = document.getElementById('routeCalcFromSelect');
  const routeCalcToSelect = document.getElementById('routeCalcToSelect');
  const routeCalcResultRibbon = document.getElementById('routeCalcResultRibbon');
  const routeCalcDuration = document.getElementById('routeCalcDuration');
  const routeCalcStopsCount = document.getElementById('routeCalcStopsCount');
  const routeCalcHaltTime = document.getElementById('routeCalcHaltTime');
  const routeModalLaunchMatrixBtn = document.getElementById('routeModalLaunchMatrixBtn');

  // Single-Day All-Station Blank Seat Matrix Elements
  const stationMatrixModal = document.getElementById('stationMatrixModal');
  const stationMatrixCloseBtn = document.getElementById('stationMatrixCloseBtn');
  const stationMatrixTrainName = document.getElementById('stationMatrixTrainName');
  const stationMatrixTrainModel = document.getElementById('stationMatrixTrainModel');
  const stationMatrixSubtitle = document.getElementById('stationMatrixSubtitle');
  const matrixJourneyDateInput = document.getElementById('matrixJourneyDateInput');
  const matrixSelectAllPairsBtn = document.getElementById('matrixSelectAllPairsBtn');
  const matrixResetPairsBtn = document.getElementById('matrixResetPairsBtn');
  const matrixFromCountBadge = document.getElementById('matrixFromCountBadge');
  const matrixToCountBadge = document.getElementById('matrixToCountBadge');
  const matrixFromDropdownBtn = document.getElementById('matrixFromDropdownBtn');
  const matrixFromDropdownLabel = document.getElementById('matrixFromDropdownLabel');
  const matrixFromDropdownArrow = document.getElementById('matrixFromDropdownArrow');
  const matrixFromDropdownMenu = document.getElementById('matrixFromDropdownMenu');
  const matrixFromOptionsContainer = document.getElementById('matrixFromOptionsContainer');
  const matrixFromSelectAllBtn = document.getElementById('matrixFromSelectAllBtn');
  const matrixFromClearBtn = document.getElementById('matrixFromClearBtn');
  const matrixToDropdownBtn = document.getElementById('matrixToDropdownBtn');
  const matrixToDropdownLabel = document.getElementById('matrixToDropdownLabel');
  const matrixToDropdownArrow = document.getElementById('matrixToDropdownArrow');
  const matrixToDropdownMenu = document.getElementById('matrixToDropdownMenu');
  const matrixToOptionsContainer = document.getElementById('matrixToOptionsContainer');
  const matrixToSelectAllBtn = document.getElementById('matrixToSelectAllBtn');
  const matrixToClearBtn = document.getElementById('matrixToClearBtn');
  const matrixExecuteQueryBtn = document.getElementById('matrixExecuteQueryBtn');
  const matrixExecuteQueryBtnText = document.getElementById('matrixExecuteQueryBtnText');
  const matrixPairsSummaryText = document.getElementById('matrixPairsSummaryText');
  const stationMatrixContent = document.getElementById('stationMatrixContent');

  // Live Coach & Seat Layout Elements
  const seatLayoutModal = document.getElementById('seatLayoutModal');
  const seatLayoutCloseBtn = document.getElementById('seatLayoutCloseBtn');
  const seatLayoutTrainName = document.getElementById('seatLayoutTrainName');
  const seatLayoutStartTime = document.getElementById('seatLayoutStartTime');
  const seatLayoutStartTimeText = document.getElementById('seatLayoutStartTimeText');
  const seatLayoutTrainModel = document.getElementById('seatLayoutTrainModel');
  const seatLayoutClassBadge = document.getElementById('seatLayoutClassBadge');
  const seatLayoutSubtitle = document.getElementById('seatLayoutSubtitle');
  const seatLayoutCoachTabs = document.getElementById('seatLayoutCoachTabs');
  const seatLayoutCoachesSummary = document.getElementById('seatLayoutCoachesSummary');
  const seatLayoutAvailableOnlyToggle = document.getElementById('seatLayoutAvailableOnlyToggle');
  const seatLayoutCoachInfoBanner = document.getElementById('seatLayoutCoachInfoBanner');
  const seatLayoutActiveCoachName = document.getElementById('seatLayoutActiveCoachName');
  const seatLayoutActiveCoachClass = document.getElementById('seatLayoutActiveCoachClass');
  const seatLayoutActiveTotalCount = document.getElementById('seatLayoutActiveTotalCount');
  const seatLayoutActiveAvailCount = document.getElementById('seatLayoutActiveAvailCount');
  const seatLayoutActiveBookedCount = document.getElementById('seatLayoutActiveBookedCount');
  const seatLayoutActiveFare = document.getElementById('seatLayoutActiveFare');
  const seatLayoutContent = document.getElementById('seatLayoutContent');
  const seatLayoutBookNowBtn = document.getElementById('seatLayoutBookNowBtn');
  const seatLayoutBookNowText = document.getElementById('seatLayoutBookNowText');
  const seatLayoutHoldBtn = document.getElementById('seatLayoutHoldBtn');
  const seatLayoutHoldText = document.getElementById('seatLayoutHoldText');
  const seatLayoutBuyBtn = document.getElementById('seatLayoutBuyBtn');
  const seatLayoutBuyText = document.getElementById('seatLayoutBuyText');
  const seatLayoutAutoBookHint = document.getElementById('seatLayoutAutoBookHint');
  const seatLayoutAutoBookHintText = document.getElementById('seatLayoutAutoBookHintText');

  // Top Menu Notification Center Elements
  const notifCenterContainer = document.getElementById('notifCenterContainer');
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifBadge = document.getElementById('notifBadge');
  const notifDropdown = document.getElementById('notifDropdown');
  const notifCountPill = document.getElementById('notifCountPill');
  const notifListContainer = document.getElementById('notifListContainer');
  const markAllReadBtn = document.getElementById('markAllReadBtn');
  const clearAllNotifsBtn = document.getElementById('clearAllNotifsBtn');
  const testNotifBtn = document.getElementById('testNotifBtn');

  // Settings Menu Elements
  const settingsDropdownContainer = document.getElementById('settingsDropdownContainer');
  const settingsMenuBtn = document.getElementById('settingsMenuBtn');
  const settingsDropdown = document.getElementById('settingsDropdown');
  const settingSoundToggle = document.getElementById('settingSoundToggle');
  const settingSoundIcon = document.getElementById('settingSoundIcon');
  const settingTestSoundBtn = document.getElementById('settingTestSoundBtn');
  const settingTestSoldOutSoundBtn = document.getElementById('settingTestSoldOutSoundBtn');
  const settingTestRadarSoundBtn = document.getElementById('settingTestRadarSoundBtn');
  const settingDesktopNotifToggle = document.getElementById('settingDesktopNotifToggle');
  const settingDarkThemeToggle = document.getElementById('settingDarkThemeToggle');
  const settingMonitorActiveBadge = document.getElementById('settingMonitorActiveBadge');
  const customMonitorSecondsInput = document.getElementById('customMonitorSecondsInput');
  const applyCustomMonitorBtn = document.getElementById('applyCustomMonitorBtn');
  const settingUserCountBadge = document.getElementById('settingUserCountBadge');
  const settingRequireLoginToggle = document.getElementById('settingRequireLoginToggle');
  const settingOpenUserMgmtBtn = document.getElementById('settingOpenUserMgmtBtn');
  const settingAccountStatusLabel = document.getElementById('settingAccountStatusLabel');
  const settingAccountUserLabel = document.getElementById('settingAccountUserLabel');
  const settingAccountRoleBadge = document.getElementById('settingAccountRoleBadge');
  const settingAccountAvatar = document.getElementById('settingAccountAvatar');
  const settingAdminLockedNotice = document.getElementById('settingAdminLockedNotice');
  const settingAdminControlsContainer = document.getElementById('settingAdminControlsContainer');
  const settingAdminTabBtn = document.getElementById('settingAdminTabBtn');
  const settingAdminSection = document.getElementById('settingAdminSection');
  const settingAuthActionBtn = document.getElementById('settingAuthActionBtn');

  // Custom Popular Routes Elements
  const popularRoutesContainer = document.getElementById('popularRoutesContainer');
  const saveCurrentRouteChipBtn = document.getElementById('saveCurrentRouteChipBtn');
  const managePopularRoutesBtn = document.getElementById('managePopularRoutesBtn');
  const quickRoutesManagerDrawer = document.getElementById('quickRoutesManagerDrawer');
  const closeRouteManagerBtn = document.getElementById('closeRouteManagerBtn');
  const profileSavedRoutesList = document.getElementById('profileSavedRoutesList');
  const savedRoutesCountBadge = document.getElementById('savedRoutesCountBadge');
  const addRouteFromInput = document.getElementById('addRouteFromInput');
  const addRouteFromSuggest = document.getElementById('addRouteFromSuggest');
  const addRouteToInput = document.getElementById('addRouteToInput');
  const addRouteToSuggest = document.getElementById('addRouteToSuggest');
  const addNewCustomRouteBtn = document.getElementById('addNewCustomRouteBtn');
  const resetDefaultRoutesBtn = document.getElementById('resetDefaultRoutesBtn');

  // User Management, Auth & Account Elements
  const headerSignInBtn = document.getElementById('headerSignInBtn');
  const headerUserMenuContainer = document.getElementById('headerUserMenuContainer');
  const headerUserDropdownBtn = document.getElementById('headerUserDropdownBtn');
  const headerUserDropdown = document.getElementById('headerUserDropdown');
  const headerUserAvatar = document.getElementById('headerUserAvatar');
  const userNavLabel = document.getElementById('userNavLabel');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const dropdownUserFullName = document.getElementById('dropdownUserFullName');
  const dropdownUserUsername = document.getElementById('dropdownUserUsername');
  const dropdownManageUsersBtn = document.getElementById('dropdownManageUsersBtn');
  const dropdownSocketMonitorLink = document.getElementById('dropdownSocketMonitorLink');
  const dropdownChangePasswordBtn = document.getElementById('dropdownChangePasswordBtn');
  const headerLogoutBtn = document.getElementById('headerLogoutBtn');
  const modalLogoutBtn = document.getElementById('modalLogoutBtn');

  const userManagementModal = document.getElementById('userManagementModal');
  const userManagementCloseBtn = document.getElementById('userManagementCloseBtn');
  const userManagementDoneBtn = document.getElementById('userManagementDoneBtn');
  const statTotalUsers = document.getElementById('statTotalUsers');
  const statActiveUsers = document.getElementById('statActiveUsers');
  const statAccessMode = document.getElementById('statAccessMode');
  const userTabListBtn = document.getElementById('userTabListBtn');
  const userTabAddBtn = document.getElementById('userTabAddBtn');
  const userListTabCount = document.getElementById('userListTabCount');
  const modalRequireLoginToggle = document.getElementById('modalRequireLoginToggle');
  const modalRequireApprovalToggle = document.getElementById('modalRequireApprovalToggle');
  const modalRequireEmailVerificationToggle = document.getElementById('modalRequireEmailVerificationToggle');
  const modalAllowRegistrationToggle = document.getElementById('modalAllowRegistrationToggle');
  const badgeRequireLoginStatus = document.getElementById('badgeRequireLoginStatus');
  const badgeRequireApprovalStatus = document.getElementById('badgeRequireApprovalStatus');
  const badgeRequireEmailVerificationStatus = document.getElementById('badgeRequireEmailVerificationStatus');
  const badgeAllowRegistrationStatus = document.getElementById('badgeAllowRegistrationStatus');
  const adminAuthNoticeToggle = document.getElementById('adminAuthNoticeToggle');
  const adminAuthNoticeInput = document.getElementById('adminAuthNoticeInput');
  const adminSaveAuthNoticeBtn = document.getElementById('adminSaveAuthNoticeBtn');
  const authNoticeBanner = document.getElementById('authNoticeBanner');
  const authNoticeText = document.getElementById('authNoticeText');
  const registrationClosedBanner = document.getElementById('registrationClosedBanner');
  const registerTabBtnText = document.getElementById('registerTabBtnText');
  const settingRequireApprovalToggle = document.getElementById('settingRequireApprovalToggle');
  const settingRequireEmailVerificationToggle = document.getElementById('settingRequireEmailVerificationToggle');
  const userSectionList = document.getElementById('userSectionList');
  const userSectionAdd = document.getElementById('userSectionAdd');
  const userSearchInput = document.getElementById('userSearchInput');
  const usersCardsContainer = document.getElementById('usersCardsContainer');

  const addUserForm = document.getElementById('addUserForm');
  const addUserName = document.getElementById('addUserName');
  const addUserUsername = document.getElementById('addUserUsername');
  const addUserPassword = document.getElementById('addUserPassword');
  const addUserRole = document.getElementById('addUserRole');
  const addUserStatus = document.getElementById('addUserStatus');
  const submitAddUserBtn = document.getElementById('submitAddUserBtn');
  const addUserFormStatus = document.getElementById('addUserFormStatus');

  const userLoginModal = document.getElementById('userLoginModal');
  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const loginTabBtn = document.getElementById('loginTabBtn');
  const registerTabBtn = document.getElementById('registerTabBtn');
  const loginSection = document.getElementById('loginSection');
  const registerSection = document.getElementById('registerSection');
  const userLoginForm = document.getElementById('userLoginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginRememberMe = document.getElementById('loginRememberMe');
  const loginErrorMsg = document.getElementById('loginErrorMsg');
  const firebaseGoogleSignInBtn = document.getElementById('firebaseGoogleSignInBtn');
  const firebaseGoogleRegisterBtn = document.getElementById('firebaseGoogleRegisterBtn');
  const userRegisterForm = document.getElementById('userRegisterForm');
  const registerName = document.getElementById('registerName');
  const registerEmail = document.getElementById('registerEmail');
  const registerUsername = document.getElementById('registerUsername');
  const registerPassword = document.getElementById('registerPassword');
  const registerConfirmPassword = document.getElementById('registerConfirmPassword');
  const submitRegisterBtn = document.getElementById('submitRegisterBtn');
  const registerStatusMsg = document.getElementById('registerStatusMsg');
  const resendVerificationContainer = document.getElementById('resendVerificationContainer');
  const resendVerificationBtn = document.getElementById('resendVerificationBtn');
  const userTabPendingBtn = document.getElementById('userTabPendingBtn');
  const userPendingTabCount = document.getElementById('userPendingTabCount');
  const headerPendingBadge = document.getElementById('headerPendingBadge');
  const manageUsersPendingBadge = document.getElementById('manageUsersPendingBadge');
  const toggleLoginPasswordBtn = document.getElementById('toggleLoginPasswordBtn');
  const userTelemetryModal = document.getElementById('userTelemetryModal');
  const closeTelemetryModalBtn = document.getElementById('closeTelemetryModalBtn');
  const telemetryUserName = document.getElementById('telemetryUserName');
  const telemetryUserHandle = document.getElementById('telemetryUserHandle');
  const telemetryLastIp = document.getElementById('telemetryLastIp');
  const telemetryDeviceIcon = document.getElementById('telemetryDeviceIcon');
  const telemetryDeviceText = document.getElementById('telemetryDeviceText');
  const telemetryBrowser = document.getElementById('telemetryBrowser');
  const telemetryAuthProvider = document.getElementById('telemetryAuthProvider');
  const telemetryEmailVerified = document.getElementById('telemetryEmailVerified');
  const telemetryLoginCount = document.getElementById('telemetryLoginCount');
  const telemetryLastLogin = document.getElementById('telemetryLastLogin');
  const telemetryCreatedAt = document.getElementById('telemetryCreatedAt');
  const telemetryIpList = document.getElementById('telemetryIpList');
  const telemetryLocation = document.getElementById('telemetryLocation');
  const telemetryIsp = document.getElementById('telemetryIsp');
  const pwaInstallBtn = document.getElementById('pwaInstallBtn');
  const alternateRoutesContainer = document.getElementById('alternateRoutesContainer');

  // Safe HTML Escaper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Live Tracker & Auto Book DOM Elements
  const seatFinderSection = document.getElementById('seatFinderSection');
  const liveTrackerSection = document.getElementById('liveTrackerSection');
  const autoBookSection = document.getElementById('autoBookSection');
  const navSeatFinderBtn = document.getElementById('navSeatFinderBtn');
  const navAutoBookBtn = document.getElementById('navAutoBookBtn');
  const navLiveTrackerBtn = document.getElementById('navLiveTrackerBtn');
  const liveTrackerCount = document.getElementById('liveTrackerCount');
  const refreshLiveTrackerBtn = document.getElementById('refreshLiveTrackerBtn');
  const refreshLiveTrackerIcon = document.getElementById('refreshLiveTrackerIcon');
  const liveSearchModeTabs = document.getElementById('liveSearchModeTabs');
  const liveSearchByTrainTab = document.getElementById('liveSearchByTrainTab');
  const liveSearchByRouteTab = document.getElementById('liveSearchByRouteTab');
  const liveSearchByTrainContainer = document.getElementById('liveSearchByTrainContainer');
  const liveSearchByRouteContainer = document.getElementById('liveSearchByRouteContainer');
  const liveTrackerSearchInput = document.getElementById('liveTrackerSearchInput');
  const clearLiveTrackerSearchBtn = document.getElementById('clearLiveTrackerSearchBtn');
  const liveTrackerSearchDropdown = document.getElementById('liveTrackerSearchDropdown');
  const liveRouteFromInput = document.getElementById('liveRouteFromInput');
  const clearLiveRouteFromBtn = document.getElementById('clearLiveRouteFromBtn');
  const liveRouteFromDropdown = document.getElementById('liveRouteFromDropdown');
  const liveRouteToInput = document.getElementById('liveRouteToInput');
  const clearLiveRouteToBtn = document.getElementById('clearLiveRouteToBtn');
  const liveRouteToDropdown = document.getElementById('liveRouteToDropdown');
  const liveTrackerFilterChips = document.getElementById('liveTrackerFilterChips');
  const liveTrackerLoadingState = document.getElementById('liveTrackerLoadingState');
  const liveTrackerEmptyState = document.getElementById('liveTrackerEmptyState');
  const liveTrackerGrid = document.getElementById('liveTrackerGrid');

  // Live Train Detail Modal Elements
  const liveTrainModal = document.getElementById('liveTrainModal');
  const closeLiveTrainModalBtn = document.getElementById('closeLiveTrainModalBtn');
  const refreshLiveTrainModalBtn = document.getElementById('refreshLiveTrainModalBtn');
  const refreshLiveTrainModalIcon = document.getElementById('refreshLiveTrainModalIcon');
  const liveTrainModalTitle = document.getElementById('liveTrainModalTitle');
  const liveTrainModalNumber = document.getElementById('liveTrainModalNumber');
  const liveModalDelayBadge = document.getElementById('liveModalDelayBadge');
  const liveTrainModalSubtitle = document.getElementById('liveTrainModalSubtitle');
  const liveModalDurationSpan = document.getElementById('liveModalDurationSpan');
  const liveModalRouteSpan = document.getElementById('liveModalRouteSpan');
  const liveModalSpeedSpan = document.getElementById('liveModalSpeedSpan');
  const liveModalLastPingSpan = document.getElementById('liveModalLastPingSpan');
  const liveModalOriginName = document.getElementById('liveModalOriginName');
  const liveModalOriginTime = document.getElementById('liveModalOriginTime');
  const liveModalProgressPctText = document.getElementById('liveModalProgressPctText');
  const liveModalDestTime = document.getElementById('liveModalDestTime');
  const liveModalDestName = document.getElementById('liveModalDestName');
  const liveModalProgressBar = document.getElementById('liveModalProgressBar');
  const liveModalCoveredKmText = document.getElementById('liveModalCoveredKmText');
  const liveModalTotalKmText = document.getElementById('liveModalTotalKmText');
  const liveModalNextStationTitle = document.getElementById('liveModalNextStationTitle');
  const liveModalNextStationSubtitle = document.getElementById('liveModalNextStationSubtitle');
  const liveModalNearestTitle = document.getElementById('liveModalNearestTitle');
  const liveModalNearestSubtitle = document.getElementById('liveModalNearestSubtitle');
  const liveModalSpeedPill = document.getElementById('liveModalSpeedPill');
  const liveModalCoachesPill = document.getElementById('liveModalCoachesPill');
  const liveModalOffDayPill = document.getElementById('liveModalOffDayPill');
  const liveModalStopsHeader = document.getElementById('liveModalStopsHeader');
  const liveModalTimelineContainer = document.getElementById('liveModalTimelineContainer');
  const liveModalTimelineTab = document.getElementById('liveModalTimelineTab');
  const liveModalMapTab = document.getElementById('liveModalMapTab');
  const liveModalMapContainer = document.getElementById('liveModalMapContainer');
  const liveModalCenterTrainBtn = document.getElementById('liveModalCenterTrainBtn');
  const liveTrackerGridTab = document.getElementById('liveTrackerGridTab');
  const liveTrackerMapTab = document.getElementById('liveTrackerMapTab');
  const liveTrackerNetworkMapContainer = document.getElementById('liveTrackerNetworkMapContainer');
  const liveModalDelayHistorySection = document.getElementById('liveModalDelayHistorySection');
  const liveModalAvgDelayBadge = document.getElementById('liveModalAvgDelayBadge');
  const liveModalDelayBars = document.getElementById('liveModalDelayBars');

  const closeFirebaseConfigBtn = document.getElementById('closeFirebaseConfigBtn');
  const firebaseConfigForm = document.getElementById('firebaseConfigForm');
  const firebaseCfgApiKey = document.getElementById('firebaseCfgApiKey');
  const firebaseCfgProjectId = document.getElementById('firebaseCfgProjectId');
  const firebaseCfgAuthDomain = document.getElementById('firebaseCfgAuthDomain');
  const saveFirebaseConfigBtn = document.getElementById('saveFirebaseConfigBtn');
  const firebaseConfigStatusMsg = document.getElementById('firebaseConfigStatusMsg');

  const resetPasswordModal = document.getElementById('resetPasswordModal');
  const resetPasswordCloseBtn = document.getElementById('resetPasswordCloseBtn');
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const resetPasswordTargetId = document.getElementById('resetPasswordTargetId');
  const resetPasswordTargetUsername = document.getElementById('resetPasswordTargetUsername');
  const resetPasswordNewInput = document.getElementById('resetPasswordNewInput');

  // Edit User Modal Elements
  const editUserModal = document.getElementById('editUserModal');
  const editUserCloseBtn = document.getElementById('editUserCloseBtn');
  const editUserForm = document.getElementById('editUserForm');
  const editUserTargetId = document.getElementById('editUserTargetId');
  const editUserTargetUsername = document.getElementById('editUserTargetUsername');
  const editUserNameInput = document.getElementById('editUserNameInput');
  const editUserEmailInput = document.getElementById('editUserEmailInput');
  const editUserRoleSelect = document.getElementById('editUserRoleSelect');
  const editUserStatusSelect = document.getElementById('editUserStatusSelect');
  const editUserCancelBtn = document.getElementById('editUserCancelBtn');

  // Released Seat Alert Banner Elements
  const releasedSeatAlertBanner = document.getElementById('releasedSeatAlertBanner');
  const releasedSeatText = document.getElementById('releasedSeatText');
  const releasedSeatBookBtn = document.getElementById('releasedSeatBookBtn');
  const closeReleasedBannerBtn = document.getElementById('closeReleasedBannerBtn');

  if (closeReleasedBannerBtn) {
    closeReleasedBannerBtn.addEventListener('click', () => {
      releasedSeatAlertBanner.classList.add('hidden');
    });
  }

  // Auth Modal Elements
  const authModal = document.getElementById('authModal');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalOpenBtn = document.getElementById('authModalOpenBtn');
  const authModalCloseBtn = document.getElementById('authModalCloseBtn');
  const authBtnIcon = document.getElementById('authBtnIcon');
  const authBtnText = document.getElementById('authBtnText');
  const statusDot = document.getElementById('statusDot');
  const statusDescription = document.getElementById('statusDescription');
  const disconnectTokenBtn = document.getElementById('disconnectTokenBtn');
  const modalAuthStatusCard = document.getElementById('modalAuthStatusCard');
  const modalRailwayProfileCard = document.getElementById('modalRailwayProfileCard');
  const railProfileName = document.getElementById('railProfileName');
  const railProfilePhone = document.getElementById('railProfilePhone');
  const railProfileEmail = document.getElementById('railProfileEmail');
  const railProfileNid = document.getElementById('railProfileNid');
  const railProfileExpires = document.getElementById('railProfileExpires');
  
  const tabScriptBtn = document.getElementById('tabScriptBtn');
  const tabMobileBtn = document.getElementById('tabMobileBtn');
  const tabTokenBtn = document.getElementById('tabTokenBtn');
  
  const scriptCopyTab = document.getElementById('scriptCopyTab');
  const mobileLoginTab = document.getElementById('mobileLoginTab');
  const pasteTokenForm = document.getElementById('pasteTokenForm');
  
  const consoleSnippet = document.getElementById('consoleSnippet');
  const copySnippetBtn = document.getElementById('copySnippetBtn');
  const scriptPasteForm = document.getElementById('scriptPasteForm');
  const scriptPasteInput = document.getElementById('scriptPasteInput');
  const pcClipboardPasteBtn = document.getElementById('pcClipboardPasteBtn');

  const mobileBookmarkletSnippet = document.getElementById('mobileBookmarkletSnippet');
  const copyMobileSnippetBtn = document.getElementById('copyMobileSnippetBtn');
  const mobilePasteForm = document.getElementById('mobilePasteForm');
  const mobilePasteInput = document.getElementById('mobilePasteInput');
  const mobileClipboardPasteBtn = document.getElementById('mobileClipboardPasteBtn');
  
  // Cloudflare Worker Mobile Login Elements
  const cfWorkerLoginForm = document.getElementById('cfWorkerLoginForm');
  const cfWorkerMobileInput = document.getElementById('cfWorkerMobileInput');
  const cfWorkerPasswordInput = document.getElementById('cfWorkerPasswordInput');
  const cfWorkerLoginBtn = document.getElementById('cfWorkerLoginBtn');
  const cfWorkerLoginStatus = document.getElementById('cfWorkerLoginStatus');
  const toggleWorkerPwdBtn = document.getElementById('toggleWorkerPwdBtn');
  
  const tokenPasteInput = document.getElementById('tokenPasteInput');
  const deviceIdInput = document.getElementById('deviceIdInput');
  const deviceKeyInput = document.getElementById('deviceKeyInput');

  const authTabsContainer = document.getElementById('authTabsContainer');
  const reconnectToggleContainer = document.getElementById('reconnectToggleContainer');
  const reconnectToggleBtn = document.getElementById('reconnectToggleBtn');
  const reconnectToggleIcon = document.getElementById('reconnectToggleIcon');

  const dashboardRailwayProfilePill = document.getElementById('dashboardRailwayProfilePill');
  const dashboardRailName = document.getElementById('dashboardRailName');
  const dashboardRailPhone = document.getElementById('dashboardRailPhone');
  const dashboardRailProfileBtn = document.getElementById('dashboardRailProfileBtn');

  const dropdownRailwayProfileSection = document.getElementById('dropdownRailwayProfileSection');
  const dropdownRailPassengerName = document.getElementById('dropdownRailPassengerName');
  const dropdownRailPassengerPhone = document.getElementById('dropdownRailPassengerPhone');
  const dropdownManageSessionBtn = document.getElementById('dropdownManageSessionBtn');

  const settingRailwayProfileCard = document.getElementById('settingRailwayProfileCard');
  const settingRailName = document.getElementById('settingRailName');
  const settingRailPhone = document.getElementById('settingRailPhone');
  const settingRailEmail = document.getElementById('settingRailEmail');
  const settingRailNid = document.getElementById('settingRailNid');

  // ----------------------------------------------------
  // Date & Station Canonical Helpers (100% Shohoz Compatible)
  // ----------------------------------------------------
  function formatShohozDoj(dateStr) {
    if (!dateStr) return '';
    const clean = String(dateStr).trim();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 3) {
        // YYYY-MM-DD (e.g. 2026-08-31)
        if (parts[0].length === 4) {
          const y = parts[0];
          const mIdx = parseInt(parts[1], 10) - 1;
          const d = parts[2].padStart(2, '0');
          if (mIdx >= 0 && mIdx < 12) {
            return `${d}-${months[mIdx]}-${y}`;
          }
        }
        // Already DD-Mmm-YYYY (e.g. 31-Aug-2026)
        if (parts[2].length === 4) {
          return clean;
        }
      }
    }
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return dateStr;
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = months[dateObj.getMonth()];
    const year = dateObj.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // Official Bangladesh Railway / Shohoz station aliases & spelling correction map
  const STATION_ALIASES = {
    'airport': 'Biman_Bandar',
    'dhaka airport': 'Biman_Bandar',
    'biman bandar': 'Biman_Bandar',
    'bimanbandar': 'Biman_Bandar',
    'biman_bandor': 'Biman_Bandar',
    'biman bandor': 'Biman_Bandar',
    'chittagong': 'Chattogram',
    'ctg': 'Chattogram',
    'chottogram': 'Chattogram',
    'chattagram': 'Chattogram',
    'comilla': 'Cumilla',
    'cumilla junction': 'Cumilla',
    'bogra': 'Bogura',
    'bogura': 'Bogura',
    'jessore': 'Jashore',
    'jashore': 'Jashore',
    'barisal': 'Barishal',
    'coxs bazar': "Cox's Bazar",
    'coxsbazar': "Cox's Bazar",
    "cox's_bazar": "Cox's Bazar",
    'coxs_bazar': "Cox's Bazar",
    'cox bazaar': "Cox's Bazar",
    'coxsbazar railway station': "Cox's Bazar",
    'jamalpur': 'Jamalpur_Town',
    'jamalpur town': 'Jamalpur_Town',
    'cantonment': 'Dhaka_Cantonment',
    'dhaka cantonment': 'Dhaka_Cantonment',
    'bhairab': 'Bhairab_Bazar',
    'bhairab bazar': 'Bhairab_Bazar',
    'b.baria': 'Brahmanbaria',
    'b-baria': 'Brahmanbaria',
    'b baria': 'Brahmanbaria',
    'brahman baria': 'Brahmanbaria',
    'dewanganj': 'Dewanganj_Bazar',
    'dewangonj': 'Dewanganj_Bazar',
    'melandah': 'Melandah_Bazar',
    'islampur': 'Islampur_Bazar',
    'sirajganj': 'Sirajganj_Bazar',
    'sirajgonj': 'Sirajganj_Bazar',
    'thakurgaon': 'Thakurgaon_Road',
    'sayedpur': 'Saidpur',
    'syedpur': 'Saidpur',
    'bhanga': 'Bhanga_Junction',
    'chandpur': 'Chandpur_Court',
    'kushtia': 'Kushtia_Court',
    'boalmari': 'Boalmari_Bazar',
    'bonarpara': 'Bonar_Para',
    'bonar para': 'Bonar_Para',
    'sreemangal': 'Sreemangal',
    'srimangal': 'Sreemangal',
    'shreemangal': 'Sreemangal',
    'parbatipur': 'Parbatipur',
    'santahar': 'Santahar',
    'mymensingh': 'Mymensingh',
    'tongi': 'Tongi',
    'joydebpur': 'Joydebpur',
    'joydevpur': 'Joydebpur',
    'gazipur': 'Joydebpur',
    'ishwardi': 'Ishwardi',
    'ishurdi': 'Ishwardi',
    'poradah': 'Poradah',
    'khulna': 'Khulna',
    'rajshahi': 'Rajshahi',
    'sylhet': 'Sylhet',
    'dinajpur': 'Dinajpur',
    'rangpur': 'Rangpur',
    'kurigram': 'Kurigram',
    'lalmonirhat': 'Lalmonirhat',
    'panchagarh': 'Panchagarh',
    'netrokona': 'Netrokona'
  };

  function getCanonicalStationName(raw) {
    if (!raw) return '';
    const clean = String(raw).trim();
    const lower = clean.toLowerCase();
    
    // Check Bengali name resolution
    if (window.i18n && window.i18n.reverseStationsMap && window.i18n.reverseStationsMap[clean]) {
      return window.i18n.reverseStationsMap[clean];
    }
    if (state.stations && state.stations.length > 0) {
      const bnMatch = state.stations.find(s => s.bn_name && (s.bn_name.trim() === clean || s.bn_name.trim().toLowerCase() === lower));
      if (bnMatch) return bnMatch.name;
    }

    if (STATION_ALIASES[lower]) {
      return STATION_ALIASES[lower];
    }

    if (state.stations && state.stations.length > 0) {
      const exactName = state.stations.find(s => s.name && s.name.toLowerCase() === lower);
      if (exactName) return exactName.name;

      const exactDisplay = state.stations.find(s => s.display_name && s.display_name.toLowerCase() === lower);
      if (exactDisplay) return exactDisplay.name;

      const underscore = lower.replace(/\s+/g, '_');
      const matchUnderscore = state.stations.find(s => s.name && s.name.toLowerCase() === underscore);
      if (matchUnderscore) return matchUnderscore.name;
    }

    return clean;
  }

  function buildShohozBookingUrl(fromCity, toCity, journeyDate, preferredClass = 'S_CHAIR') {
    const canonicalFrom = getCanonicalStationName(fromCity || state.selectedFrom || 'Dhaka');
    const canonicalTo = getCanonicalStationName(toCity || state.selectedTo || 'Chattogram');
    const canonicalDoj = formatShohozDoj(journeyDate || state.selectedDate || new Date().toISOString().split('T')[0]);
    const chosenClass = (preferredClass && preferredClass !== 'ALL' && preferredClass !== 'ANY') ? String(preferredClass).toUpperCase() : 'S_CHAIR';

    return `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(canonicalDoj)}&class=${encodeURIComponent(chosenClass)}`;
  }

  // ----------------------------------------------------
  // Initialization
  // ----------------------------------------------------
  initTheme();
  setupDateLimits();
  generateQuickDateChips();
  fetchStations();
  fetchTrainsCatalog();
  checkRailwaySessionStatus();
  loadPopularRoutesFromServer();
  setupEventListeners();

  // ----------------------------------------------------
  // Theme & Preferences Management
  // ----------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('rail_theme') || 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // ----------------------------------------------------
  // Settings & Preferences Menu (Sound, Desktop Alerts, Theme)
  // ----------------------------------------------------
  function initSettingsMenu() {
    // 1. Sound toggle in settings
    if (settingSoundToggle) {
      settingSoundToggle.checked = state.isSoundEnabled;
      updateSoundUI();

      settingSoundToggle.addEventListener('change', () => {
        state.isSoundEnabled = settingSoundToggle.checked;
        try {
          localStorage.setItem('rail_sound', state.isSoundEnabled ? 'true' : 'false');
        } catch (e) {}
        updateSoundUI();
        showToast(state.isSoundEnabled ? '🔊 Seat alert sound turned ON' : '🔇 Seat alert sound turned OFF', 'info');
      });
    }

    if (settingTestSoundBtn) {
      settingTestSoundBtn.addEventListener('click', () => {
        if (!state.isSoundEnabled) {
          state.isSoundEnabled = true;
          if (settingSoundToggle) settingSoundToggle.checked = true;
          updateSoundUI();
        }
        playNormalSeatReleaseSound();
        showToast('🔔 <b>Normal Seat Chime:</b> Gentle railway bell for routine seat availability', 'info');
      });
    }

    if (settingTestSoldOutSoundBtn) {
      settingTestSoldOutSoundBtn.addEventListener('click', () => {
        if (!state.isSoundEnabled) {
          state.isSoundEnabled = true;
          if (settingSoundToggle) settingSoundToggle.checked = true;
          updateSoundUI();
        }
        playSoldOutReleasedSound();
        showSoldOutReleasedToast('Sonar Bangla Express', 'S_CHAIR', 4, '#');
      });
    }

    if (settingTestRadarSoundBtn) {
      settingTestRadarSoundBtn.addEventListener('click', () => {
        if (!state.isSoundEnabled) {
          state.isSoundEnabled = true;
          if (settingSoundToggle) settingSoundToggle.checked = true;
          updateSoundUI();
        }
        playRadarTargetHitSound();
        showRadarHitToast('Suborno Express', 'SNIGDHA', 4, '#');
      });
    }

    // 2. Desktop notification setting in settings
    if (settingDesktopNotifToggle) {
      settingDesktopNotifToggle.checked = ('Notification' in window && Notification.permission === 'granted');
      
      settingDesktopNotifToggle.addEventListener('change', async () => {
        if (settingDesktopNotifToggle.checked) {
          if (!('Notification' in window)) {
            showToast('Desktop notifications are not supported by your browser.', 'error');
            settingDesktopNotifToggle.checked = false;
            return;
          }
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            showToast('🎉 Closed-browser & desktop notifications enabled!', 'success');
            subscribeToClosedBrowserPush();
            sendDesktopNotification('🔔 Bangladesh Railway Alert Active', 'You will receive instant alerts here even when your browser is closed.', null);
          } else {
            settingDesktopNotifToggle.checked = false;
            showToast('Desktop notifications were not allowed. Check browser site permissions.', 'info');
          }
        } else {
          showToast('Desktop notifications disabled. You can still view alerts in the top bell menu.', 'info');
        }
      });
    }

    // 3. Dark Theme setting in settings
    if (settingDarkThemeToggle) {
      settingDarkThemeToggle.checked = document.documentElement.classList.contains('dark');
      settingDarkThemeToggle.addEventListener('change', () => {
        const isDark = settingDarkThemeToggle.checked;
        document.documentElement.classList.toggle('dark', isDark);
        try {
          localStorage.setItem('rail_theme', isDark ? 'dark' : 'light');
        } catch (e) {}
      });
    }

    // 4. Auto-Monitor / Polling Interval Presets
    document.querySelectorAll('.monitor-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = parseInt(btn.dataset.sec, 10);
        setPollingInterval(sec, true);
      });
    });

    // 5. Custom Monitor Seconds Input
    if (applyCustomMonitorBtn && customMonitorSecondsInput) {
      applyCustomMonitorBtn.addEventListener('click', () => {
        applyCustomMonitorSeconds();
      });

      customMonitorSecondsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustomMonitorSeconds();
        }
      });
    }

    function applyCustomMonitorSeconds() {
      const val = parseInt(customMonitorSecondsInput.value, 10);
      if (isNaN(val) || val < 5 || val > 600) {
        showToast('Please enter a valid monitor interval between 5 and 600 seconds.', 'error');
        return;
      }
      setPollingInterval(val, true);
    }

    // 6. Category Tabs Filter
    const catTabs = document.querySelectorAll('.setting-cat-tab');
    const catSections = document.querySelectorAll('.setting-cat-section');

    catTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedCat = tab.dataset.cat;
        
        // Update active tab styles
        catTabs.forEach(t => {
          if (t === tab) {
            t.className = 'setting-cat-tab px-2.5 py-1 rounded-lg font-bold transition bg-emerald-600 text-white shadow-2xs cursor-pointer shrink-0';
          } else {
            t.className = 'setting-cat-tab px-2.5 py-1 rounded-lg font-bold transition text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60 cursor-pointer shrink-0';
          }
        });

        // Show/hide sections (Admin section is strictly restricted to admin users)
        const isAdmin = !!(state.currentUser && state.currentUser.role === 'admin');
        catSections.forEach(section => {
          if (section.dataset.cat === 'admin' && !isAdmin) {
            section.classList.add('hidden');
            return;
          }
          if (selectedCat === 'all' || section.dataset.cat === selectedCat) {
            section.classList.remove('hidden');
          } else {
            section.classList.add('hidden');
          }
        });
      });
    });

    // 7. Dropdown / Modal Toggle Handler
    if (settingsMenuBtn) {
      settingsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = settingsDropdown.classList.contains('hidden');
        if (notifDropdown) notifDropdown.classList.add('hidden');
        if (isHidden) {
          settingsDropdown.classList.remove('hidden');
          const isAdmin = !!(state.currentUser && state.currentUser.role === 'admin');
          if (settingAdminTabBtn) settingAdminTabBtn.classList.toggle('hidden', !isAdmin);
          if (settingAdminSection) settingAdminSection.classList.toggle('hidden', !isAdmin);
          if (settingSoundToggle) settingSoundToggle.checked = state.isSoundEnabled;
          if (settingDarkThemeToggle) settingDarkThemeToggle.checked = document.documentElement.classList.contains('dark');
          if (settingDesktopNotifToggle) settingDesktopNotifToggle.checked = ('Notification' in window && Notification.permission === 'granted');
          updateMonitorUI(state.pollingInterval);

          // Update Telegram UI State
          updateTelegramUI();

          // Ensure active category tab displays properly
          const activeTab = document.querySelector('.setting-cat-tab.bg-emerald-600') || document.querySelector('.setting-cat-tab[data-cat="all"]');
          if (activeTab) activeTab.click();
        } else {
          settingsDropdown.classList.add('hidden');
        }
      });
    }

    const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
    if (closeSettingsModalBtn) {
      closeSettingsModalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsDropdown) settingsDropdown.classList.add('hidden');
      });
    }

    if (settingsDropdown) {
      settingsDropdown.addEventListener('click', (e) => {
        // If clicking directly on the mobile backdrop outside the card, close the modal
        if (e.target === settingsDropdown) {
          settingsDropdown.classList.add('hidden');
        }
      });
    }

    // Close on outside click (for desktop dropdown mode)
    document.addEventListener('click', (e) => {
      if (settingsDropdownContainer && !settingsDropdownContainer.contains(e.target) && !settingsDropdown.contains(e.target)) {
        if (settingsDropdown) settingsDropdown.classList.add('hidden');
      }
    });

    // Accessible Global Escape Key Listener to dismiss topmost open modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
        const activeModals = [
          document.getElementById('authModal'),
          document.getElementById('settingsDropdown'),
          document.getElementById('setWatchTargetModal'),
          document.getElementById('watchlistModal'),
          document.getElementById('routeExplorerModal'),
          document.getElementById('stationMatrixModal'),
          document.getElementById('userLoginModal'),
          document.getElementById('userManagementModal'),
          document.getElementById('analyticsDashboardModal'),
          document.getElementById('shareModal')
        ];
        for (const modal of activeModals) {
          if (modal && !modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
            break;
          }
        }
      }
    });
  }

  function updateSoundUI() {
    if (settingSoundIcon) {
      if (state.isSoundEnabled) {
        settingSoundIcon.className = 'fa-solid fa-volume-high text-emerald-600 dark:text-emerald-400 text-xs';
      } else {
        settingSoundIcon.className = 'fa-solid fa-volume-xmark text-slate-400 text-xs';
      }
    }
  }

  function setPollingInterval(sec, showUserToast = true) {
    sec = isNaN(sec) ? 0 : Math.max(0, Math.min(600, sec));
    state.pollingInterval = sec;
    try {
      localStorage.setItem('rail_polling_interval', String(sec));
    } catch (e) {}

    updateMonitorUI(sec);
    restartPollingTimer();

    if (showUserToast) {
      if (sec > 0) {
        showToast(`⏱️ Auto-monitor set to every ${sec}s`, 'info');
      } else {
        showToast('⏸️ Auto-monitor turned OFF', 'info');
      }
    }
  }

  function updateMonitorUI(sec) {
    // 1. Update active badge in settings
    if (settingMonitorActiveBadge) {
      if (sec === 0) {
        settingMonitorActiveBadge.textContent = 'Off';
        settingMonitorActiveBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700';
      } else {
        settingMonitorActiveBadge.textContent = sec < 60 ? `${sec}s` : (sec % 60 === 0 ? `${sec/60}m` : `${sec}s`);
        settingMonitorActiveBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60';
      }
    }

    // 2. Update preset buttons
    document.querySelectorAll('.monitor-preset-btn').forEach(btn => {
      const bSec = parseInt(btn.dataset.sec, 10);
      if (bSec === sec) {
        btn.className = 'monitor-preset-btn px-1.5 py-1 text-[11px] font-bold rounded-lg border border-emerald-500 bg-emerald-600 text-white shadow-xs transition';
      } else {
        btn.className = 'monitor-preset-btn px-1.5 py-1 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-700 transition';
      }
    });

    // 3. Update custom input
    if (customMonitorSecondsInput) {
      const isPreset = [0, 15, 30, 60, 120].includes(sec);
      customMonitorSecondsInput.value = isPreset ? '' : sec;
    }

    // 4. Update toolbar select dropdown
    if (pollingIntervalSelect) {
      let matchOption = Array.from(pollingIntervalSelect.options).find(o => parseInt(o.value, 10) === sec);
      if (!matchOption && sec > 0) {
        const opt = document.createElement('option');
        opt.value = sec;
        opt.textContent = `Custom (${sec}s)`;
        pollingIntervalSelect.appendChild(opt);
        pollingIntervalSelect.value = String(sec);
      } else if (matchOption) {
        pollingIntervalSelect.value = String(sec);
      }
    }

    // 5. Update polling indicator
    if (pollingIndicator) {
      pollingIndicator.classList.toggle('hidden', sec === 0);
    }
  }

  // ----------------------------------------------------
  // Authentication & Persistent Shohoz Session Management
  // ----------------------------------------------------
  async function checkRailwaySessionStatus() {
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/auth/status?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      console.log('[Shohoz Auth Sync]', data);
      const active = !!(data.authenticated && data.user && !data.user.isExpired && data.user.name && data.user.name !== '---');
      updateAuthUI(active, data.user, data.token_preview, data.device_id, data.device_key, data.has_saved_session);
    } catch (err) {
      console.warn('Could not check auth status:', err);
    }
  }

  function updateAuthUI(isAuth, user, tokenPreview, deviceId, deviceKey, isSaved = false) {
    state.isAuthenticated = isAuth;
    state.authUserData = user;

    if (deviceId && deviceIdInput) deviceIdInput.value = deviceId;
    if (deviceKey && deviceKeyInput && deviceKey.toLowerCase() !== 'web') deviceKeyInput.value = deviceKey;

    const pName = user?.name || user?.display_name || user?.phone || user?.phone_number || user?.username || '---';
    const pPhone = user?.phone || user?.mobile_number || user?.phone_number || user?.username || '---';
    const pEmail = user?.email || '---';
    const pNidRaw = user?.nid || user?.nidn || '';
    const pNidType = user?.nidType || user?.nidnt || 'NID';
    const pNid = pNidRaw ? `${pNidRaw} (${pNidType})` : '---';
    const displayName = pName.split(' ')[0] || 'Live';

    if (isAuth) {
      authModalOpenBtn.className = 'flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-xs bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer shrink-0';
      authBtnIcon.className = 'fa-solid fa-circle-check text-[11px]';
      authBtnText.textContent = `🚆 ${displayName}`;
      
      liveBadge.className = 'text-xs px-2.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800';
      liveBadge.textContent = '🟢 100% Live API';
      if (searchModeBadge) searchModeBadge.textContent = 'Shohoz Live API';

      if (authModalTitle) authModalTitle.textContent = 'Bangladesh Railway Live Session & Profile';
      if (statusDescription) {
        statusDescription.textContent = `Status: Connected as ${pName}`;
      }
      if (statusDot) {
        statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
      }
      if (modalAuthStatusCard) modalAuthStatusCard.classList.add('hidden');
      if (modalRailwayProfileCard) {
        modalRailwayProfileCard.classList.remove('hidden');
        if (railProfileName) railProfileName.textContent = pName;
        if (railProfilePhone) railProfilePhone.textContent = pPhone;
        if (railProfileEmail) railProfileEmail.textContent = pEmail;
        if (railProfileNid) railProfileNid.textContent = pNid;
        if (railProfileExpires) {
          railProfileExpires.textContent = user?.expiresAt 
            ? 'Session valid until ' + new Date(user.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Active Live Session';
        }
      }

      // Reconnect switcher in modal (collapsed when connected)
      if (reconnectToggleContainer) reconnectToggleContainer.classList.remove('hidden');
      if (authTabsContainer) authTabsContainer.classList.add('hidden');

      // 1. Dashboard Hero Profile Card
      if (dashboardRailwayProfilePill) {
        dashboardRailwayProfilePill.classList.remove('hidden');
        dashboardRailwayProfilePill.classList.add('flex');
        if (dashboardRailName) dashboardRailName.textContent = pName;
        if (dashboardRailPhone) dashboardRailPhone.textContent = pPhone;
      }

      // 2. Top Header User Dropdown Railway Profile Section
      if (dropdownRailwayProfileSection) {
        dropdownRailwayProfileSection.classList.remove('hidden');
        if (dropdownRailPassengerName) dropdownRailPassengerName.textContent = pName;
        if (dropdownRailPassengerPhone) dropdownRailPassengerPhone.textContent = pPhone;
      }

      // 3. Settings Modal Category 5 Railway Profile Card
      if (settingRailwayProfileCard) {
        settingRailwayProfileCard.classList.remove('hidden');
        if (settingRailName) settingRailName.textContent = pName;
        if (settingRailPhone) settingRailPhone.textContent = pPhone;
        if (settingRailEmail) settingRailEmail.textContent = pEmail;
        if (settingRailNid) settingRailNid.textContent = pNid;
      }

      noticeBanner.classList.add('hidden');
    } else {
      authModalOpenBtn.className = 'flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 cursor-pointer shrink-0';
      authBtnIcon.className = 'fa-solid fa-key text-[11px]';
      authBtnText.textContent = 'Connect Live API';
      
      liveBadge.className = 'text-xs px-2.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800';
      liveBadge.textContent = '⚡ Connect Session';
      if (searchModeBadge) searchModeBadge.textContent = 'Session Required';

      if (authModalTitle) authModalTitle.textContent = 'Connect Live Shohoz API';
      if (statusDescription) {
        statusDescription.textContent = 'Status: Not Connected';
      }
      if (statusDot) {
        statusDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
      }
      if (modalRailwayProfileCard) modalRailwayProfileCard.classList.add('hidden');
      if (modalAuthStatusCard) modalAuthStatusCard.classList.remove('hidden');

      if (reconnectToggleContainer) reconnectToggleContainer.classList.add('hidden');
      if (authTabsContainer) authTabsContainer.classList.remove('hidden');

      if (dashboardRailwayProfilePill) {
        dashboardRailwayProfilePill.classList.add('hidden');
        dashboardRailwayProfilePill.classList.remove('flex');
      }
      if (dropdownRailwayProfileSection) dropdownRailwayProfileSection.classList.add('hidden');
      if (settingRailwayProfileCard) settingRailwayProfileCard.classList.add('hidden');

      noticeBanner.className = 'p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60 animate-fade-in';
      noticeText.textContent = 'Click "Connect Live API" to sync your Bangladesh Railway session. Your session will be automatically saved for future visits.';
      bannerConnectBtn.classList.remove('hidden');
      noticeBanner.classList.remove('hidden');
    }
  }

  // Modal Open / Close — immediately reflect cached auth state, then refresh from server
  function openAuthModal() {
    // Immediately show correct state from cache (no flicker)
    updateAuthUI(state.isAuthenticated, state.authUserData, null, null, null, state.isAuthenticated);
    if (authModal) authModal.classList.remove('hidden');
    if (typeof initTurnstileLoginWidget === 'function') setTimeout(initTurnstileLoginWidget, 100);
    // Then refresh from server in background
    checkRailwaySessionStatus();
  }

  if (authModalOpenBtn) authModalOpenBtn.addEventListener('click', openAuthModal);
  if (bannerConnectBtn) bannerConnectBtn.addEventListener('click', openAuthModal);
  if (dashboardRailProfileBtn) dashboardRailProfileBtn.addEventListener('click', openAuthModal);
  if (dropdownManageSessionBtn) {
    dropdownManageSessionBtn.addEventListener('click', () => {
      const headerUserDropdown = document.getElementById('headerUserDropdown');
      if (headerUserDropdown) headerUserDropdown.classList.add('hidden');
      openAuthModal();
    });
  }

  if (authModalCloseBtn) authModalCloseBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) authModal.classList.add('hidden');
    });
  }

  // Toggle Reconnect Tabs inside Modal
  if (reconnectToggleBtn && authTabsContainer) {
    reconnectToggleBtn.addEventListener('click', () => {
      const isHidden = authTabsContainer.classList.toggle('hidden');
      if (reconnectToggleIcon) {
        reconnectToggleIcon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    });
  }

  // Tab Switching in Modal (PC Console vs Manual Paste vs Mobile Login)
  const activeTabClass = 'py-2 px-1 text-center rounded-lg text-xs font-bold bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs cursor-pointer transition flex items-center justify-center space-x-1.5';
  const inactiveTabClass = 'py-2 px-1 text-center rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer transition flex items-center justify-center space-x-1.5';

  function resetTabs() {
    if (tabScriptBtn) tabScriptBtn.className = inactiveTabClass;
    if (tabTokenBtn) tabTokenBtn.className = inactiveTabClass;
    if (tabMobileBtn) tabMobileBtn.className = inactiveTabClass;

    if (scriptCopyTab) scriptCopyTab.classList.add('hidden');
    if (pasteTokenForm) pasteTokenForm.classList.add('hidden');
    if (mobileLoginTab) mobileLoginTab.classList.add('hidden');
  }

  if (tabScriptBtn) {
    tabScriptBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetTabs();
      tabScriptBtn.className = activeTabClass;
      if (scriptCopyTab) scriptCopyTab.classList.remove('hidden');
    });
  }

  if (tabTokenBtn) {
    tabTokenBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetTabs();
      tabTokenBtn.className = activeTabClass;
      if (pasteTokenForm) pasteTokenForm.classList.remove('hidden');
    });
  }

  if (tabMobileBtn) {
    tabMobileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetTabs();
      tabMobileBtn.className = activeTabClass;
      if (mobileLoginTab) {
        mobileLoginTab.classList.remove('hidden');
        if (typeof initTurnstileLoginWidget === 'function') initTurnstileLoginWidget();
      }
    });
  }

  // Helper for reliable clipboard copy across HTTP and HTTPS
  async function copyTextToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // fallback below
      }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Helper for 1-tap clipboard paste & activate
  async function pasteClipboardAndConnect(targetInput) {
    let clipText = '';
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        clipText = await navigator.clipboard.readText();
      } catch (err) {
        console.warn('Clipboard read error or permission denied:', err);
      }
    }
    if (!clipText && targetInput && targetInput.value) {
      clipText = targetInput.value;
    }
    if (!clipText) {
      showToast('Please paste your session JSON or cURL into the box.', 'info');
      if (targetInput) targetInput.focus();
      return;
    }
    if (targetInput) targetInput.value = clipText;
    await handleTokenActivation(clipText);
  }

  // PC 1-Tap Clipboard Paste Button
  if (pcClipboardPasteBtn) {
    pcClipboardPasteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await pasteClipboardAndConnect(scriptPasteInput);
    });
  }

  // Mobile 1-Tap Clipboard Paste Button
  if (mobileClipboardPasteBtn) {
    mobileClipboardPasteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await pasteClipboardAndConnect(mobilePasteInput);
    });
  }

  // Copy Snippet Button (PC)
  if (copySnippetBtn && consoleSnippet) {
    consoleSnippet.addEventListener('click', () => consoleSnippet.select());
    copySnippetBtn.addEventListener('click', async () => {
      await copyTextToClipboard(consoleSnippet.value);
      copySnippetBtn.textContent = 'Copied!';
      setTimeout(() => copySnippetBtn.textContent = 'Copy', 2000);
      showToast('Script copied! Paste into eticket.railway.gov.bd Console.', 'info');
    });
  }

  // Copy Mobile Bookmarklet Snippet Button
  if (copyMobileSnippetBtn && mobileBookmarkletSnippet) {
    mobileBookmarkletSnippet.addEventListener('click', () => mobileBookmarkletSnippet.select());
    copyMobileSnippetBtn.addEventListener('click', async () => {
      await copyTextToClipboard(mobileBookmarkletSnippet.value);
      copyMobileSnippetBtn.textContent = 'Copied!';
      setTimeout(() => copyMobileSnippetBtn.textContent = 'Copy', 2000);
      showToast('Mobile bookmark script copied! Paste as bookmark URL.', 'info');
    });
  }

  // Helper to Parse & Activate JSON / Token / cURL
  async function handleTokenActivation(rawString) {
    const raw = (rawString || '').trim();
    if (!raw) {
      showToast('Please paste the JSON or cURL script output.', 'error');
      return;
    }

    let token = '';
    let deviceId = '';
    let deviceKey = '';

    // If it is pure JSON string
    let cftResponse = '';
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const obj = JSON.parse(raw);
        token = obj.token || obj.access_token || obj.authToken || '';
        deviceId = obj['x-device-id'] || obj.device_id || obj.deviceId || '';
        deviceKey = obj['x-device-key'] || obj.device_key || obj.deviceKey || obj.ssdk || obj._ssdk || '';
        cftResponse = obj.cft_response || obj.cftResponse || obj['cf-turnstile-response'] || '';
      } catch (e) {
        // Fallback to regex
      }
    }

    // If not found yet, check regex for JSON-like properties or cURL headers
    if (!token) {
      const tm = raw.match(/["']?token["']?\s*:\s*["']([^"']+)["']/i) || 
                 raw.match(/[-H\s]['"]?[Aa]uthorization:\s*(?:Bearer\s+)?([^'"\r\n]+)['"]?/i);
      if (tm) token = tm[1];
    }
    if (!token) {
      const jm = raw.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]{10,}/);
      if (jm) token = jm[0];
    }

    if (!deviceId) {
      const dm = raw.match(/["']?x-device-id["']?\s*:\s*["']([^"']+)["']/i) ||
                 raw.match(/["']?device_id["']?\s*:\s*["']([^"']+)["']/i) ||
                 raw.match(/[-H\s]['"]?x-device-id:\s*([^'"\r\n]+)['"]?/i);
      if (dm) deviceId = dm[1];
    }

    if (!deviceKey) {
      const km = raw.match(/["']?x-device-key["']?\s*:\s*["']([^"']+)["']/i) ||
                 raw.match(/["']?device_key["']?\s*:\s*["']([^"']+)["']/i) ||
                 raw.match(/["']?_?ssdk["']?\s*:\s*["']([^"']+)["']/i) ||
                 raw.match(/[-H\s]['"]?x-device-key:\s*([^'"\r\n]+)['"]?/i);
      if (km) deviceKey = km[1];
    }

    if (!cftResponse) {
      const cm = raw.match(/["']?(?:cft_response|cftResponse|cf-turnstile-response)["']?\s*:\s*["']([^"']+)["']/i) ||
                 raw.match(/(?:cft_response|cf-turnstile-response)=([^&'"\s]+)/i);
      if (cm) cftResponse = decodeURIComponent(cm[1]);
    }

    token = (token || '').replace(/^Bearer\s+/i, '').trim();
    deviceId = (deviceId || '').trim();
    deviceKey = (deviceKey || '').trim();
    cftResponse = (cftResponse || '').trim();

    if (!token) {
      if (cftResponse) {
        try {
          localStorage.setItem('railway_cft_response', cftResponse);
          localStorage.setItem('cft_response', cftResponse);
        } catch (e) {}
        await saveCredentials({ cft_response: cftResponse });
        showToast(window.i18n?.getLang() === 'bn' ? 'রেলওয়ে লাইভ টার্নস্টাইল টোকেন সফলভাবে সংরক্ষিত হয়েছে!' : 'Railway Turnstile token (cft_response) updated successfully!', 'success');
        return;
      }
      showToast('Could not find a valid Railway token in the pasted text.', 'error');
      return;
    }

    if (deviceKey && (deviceKey.toLowerCase() === 'web' || deviceKey === 'null' || deviceKey === 'undefined')) {
      deviceKey = '';
    }

    await saveCredentials({ token, device_id: deviceId, device_key: deviceKey, cft_response: cftResponse, raw_curl: raw });
  }

  // Tab 1: PC Script Paste Form Handler
  if (scriptPasteForm) {
    scriptPasteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleTokenActivation(scriptPasteInput.value);
    });
  }

  // Tab 3: Direct Mobile Sign-In via Cloudflare Edge Worker
  const CF_WORKER_URL = 'https://broad-glade-2ddb.mlinksbd14.workers.dev';

  if (toggleWorkerPwdBtn && cfWorkerPasswordInput) {
    toggleWorkerPwdBtn.addEventListener('click', () => {
      const isPwd = cfWorkerPasswordInput.type === 'password';
      cfWorkerPasswordInput.type = isPwd ? 'text' : 'password';
      toggleWorkerPwdBtn.innerHTML = isPwd ? '<i class="fa-regular fa-eye-slash text-xs text-emerald-600"></i>' : '<i class="fa-regular fa-eye text-xs"></i>';
    });
  }

  // ----------------------------------------------------
  // Cloudflare Turnstile Live Browser Challenge Solver
  // ----------------------------------------------------
  let _cfTurnstileWidgetId = null;
  let _cftLoginToken = '';

  function initTurnstileLoginWidget() {
    const slot = document.getElementById('cfTurnstileWidgetSlot');
    const indicator = document.getElementById('cftStatusIndicator');
    if (!slot) return;

    if (!window.turnstile) {
      if (!window._turnstileWaitInterval) {
        let attempts = 0;
        window._turnstileWaitInterval = setInterval(() => {
          attempts++;
          if (window.turnstile) {
            clearInterval(window._turnstileWaitInterval);
            window._turnstileWaitInterval = null;
            initTurnstileLoginWidget();
          } else if (attempts > 15) {
            clearInterval(window._turnstileWaitInterval);
            window._turnstileWaitInterval = null;
            if (indicator) {
              indicator.className = 'font-bold text-indigo-500 flex items-center gap-1';
              indicator.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i><span>Syncing Token...</span>';
            }
            if (typeof requestBackgroundTurnstileToken === 'function') requestBackgroundTurnstileToken(true);
          }
        }, 300);
      }
      return;
    }

    if (_cfTurnstileWidgetId !== null) {
      try { window.turnstile.reset(_cfTurnstileWidgetId); } catch(e) {}
      return;
    }

    try {
      _cfTurnstileWidgetId = window.turnstile.render('#cfTurnstileWidgetSlot', {
        sitekey: '0x4AAAAAAB5VTjZ90pUxRuXR',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        size: 'normal',
        callback: (token) => {
          console.log('[Turnstile] ✅ Browser auto-solved challenge! Token acquired:', token.substring(0, 15) + '...');
          _cftLoginToken = token;
          window._activeTurnstileToken = token;
          try {
            localStorage.setItem('railway_cft_response', token);
            localStorage.setItem('cft_response', token);
          } catch(e) {}
          if (indicator) {
            indicator.className = 'font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1';
            indicator.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500"></i><span>Verified by Cloudflare</span>';
          }
          if (cfWorkerLoginBtn) {
            cfWorkerLoginBtn.classList.add('ring-2', 'ring-emerald-400');
          }
        },
        'expired-callback': () => {
          _cftLoginToken = '';
          if (indicator) {
            indicator.className = 'font-bold text-amber-500 flex items-center gap-1';
            indicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span><span>Expired, Refreshing...</span>';
          }
          if (_cfTurnstileWidgetId !== null) window.turnstile.reset(_cfTurnstileWidgetId);
        },
        'error-callback': (errCode) => {
          console.warn('[Turnstile] Widget error or domain lock:', errCode);
          if (indicator) {
            indicator.className = 'font-bold text-indigo-500 flex items-center gap-1';
            indicator.innerHTML = '<i class="fa-solid fa-cloud-arrow-down animate-bounce"></i><span>Syncing Bridge Token...</span>';
          }
          if (typeof requestBackgroundTurnstileToken === 'function') {
            requestBackgroundTurnstileToken(true).then(() => {
              const fresh = window._freshBridgeCft || getStoredCftResponse();
              if (fresh) {
                _cftLoginToken = fresh;
                if (indicator) {
                  indicator.className = 'font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1';
                  indicator.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500"></i><span>Bridge Token Active</span>';
                }
              }
            });
          }
        }
      });
    } catch (err) {
      console.warn('[Turnstile] Error rendering widget:', err);
    }
  }

  if (cfWorkerLoginForm) {
    cfWorkerLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mobile = (cfWorkerMobileInput?.value || '').trim();
      const password = cfWorkerPasswordInput?.value || '';

      if (!mobile || !password) {
        showToast('Please enter both mobile number and password.', 'warning');
        return;
      }

      const activeCft = _cftLoginToken || window._activeTurnstileToken || getStoredCftResponse() || '';

      if (cfWorkerLoginBtn) {
        cfWorkerLoginBtn.disabled = true;
        cfWorkerLoginBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Authenticating via Railway Gateway...</span>';
      }
      if (cfWorkerLoginStatus) {
        cfWorkerLoginStatus.className = 'text-[11px] p-2 rounded-lg font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50 block';
        cfWorkerLoginStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Contacting Bangladesh Railway Authentication with Turnstile Verification...';
      }

      try {
        let data = null;
        const loginPayload = {
          mobile_number: mobile,
          password: password,
          cft_response: activeCft
        };

        // 1. Primary: Server endpoint (relays directly to official Shohoz backend with full mobile SSDK headers)
        try {
          const backendRes = await fetch('/api/shohoz-signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginPayload)
          });
          data = await backendRes.json();
        } catch (fetchErr) {
          console.warn('[Login] Primary signin error, trying Cloudflare Worker fallback:', fetchErr);
        }

        // 2. Fallback: Direct Cloudflare Edge Worker
        if (!data || !data.success) {
          try {
            const workerRes = await fetch(`${CF_WORKER_URL}/api/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(loginPayload)
            });
            const workerData = await workerRes.json();
            if (workerData && workerData.success) {
              data = workerData;
            }
          } catch (_) {}
        }

        if (data && data.success && data.token) {
          if (cfWorkerLoginStatus) {
            cfWorkerLoginStatus.className = 'text-[11px] p-2 rounded-lg font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/50 block';
            cfWorkerLoginStatus.innerHTML = '✅ Sign-in verified! Activating Live Session...';
          }
          await saveCredentials({
            token: data.token,
            device_id: data.device_id || data.deviceId,
            device_key: data.device_key || data.deviceKey,
            cft_response: activeCft
          });
          if (cfWorkerPasswordInput) cfWorkerPasswordInput.value = '';
          if (cfWorkerLoginStatus) cfWorkerLoginStatus.classList.add('hidden');
          showToast('Signed in successfully to Bangladesh Railway!', 'success');
        } else {
          const errDetail = data?.error || data?.message || 'Authentication rejected by Bangladesh Railway.';
          if (cfWorkerLoginStatus) {
            cfWorkerLoginStatus.className = 'text-[11px] p-2 rounded-lg font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800/50 block';
            cfWorkerLoginStatus.innerHTML = `⚠️ ${errDetail}`;
          }
          showToast(errDetail, 'error');
        }
      } catch (err) {
        if (cfWorkerLoginStatus) {
          cfWorkerLoginStatus.className = 'text-[11px] p-2 rounded-lg font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800/50 block';
          cfWorkerLoginStatus.innerHTML = `⚠️ Network error: ${err.message}`;
        }
        showToast(`Sign in error: ${err.message}`, 'error');
      } finally {
        if (cfWorkerLoginBtn) {
          cfWorkerLoginBtn.disabled = false;
          cfWorkerLoginBtn.innerHTML = '<i class="fa-solid fa-bolt"></i><span>Sign In with Active Turnstile Token</span>';
        }
      }
    });
  }

  // Tab 3 Alternative: Mobile Paste Form Handler
  if (mobilePasteForm) {
    mobilePasteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleTokenActivation(mobilePasteInput.value);
    });
  }

  // Tab 3: Manual Paste Form Handler
  if (pasteTokenForm) {
    pasteTokenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = tokenPasteInput.value.trim();
      const deviceId = deviceIdInput.value.trim();
      let deviceKey = deviceKeyInput.value.trim();
      if (deviceKey.toLowerCase() === 'web' || deviceKey === 'null' || deviceKey === 'undefined') {
        deviceKey = '';
      }

      if (!token) {
        showToast('Please enter your Bearer token.', 'error');
        return;
      }

      await saveCredentials({ token, device_id: deviceId, device_key: deviceKey });
    });
  }

  // Save Credentials Helper
  async function saveCredentials(payload) {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/auth/set-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        // Cache the Turnstile token locally too, so the seat-layout request can
        // carry it immediately without a round trip to read the session back.
        const cft = payload.cft_response || payload.cftResponse || '';
        try {
          if (cft) {
            localStorage.setItem('cft_response', cft);
          } else {
            localStorage.removeItem('cft_response');
          }
        } catch (e) { /* storage unavailable */ }

        const userName = data.user?.name || 'Railway Passenger';
        showToast(`✅ Live Railway session connected as ${userName}!`, 'success');
        updateAuthUI(true, data.user, data.token_preview, data.device_id, data.device_key, true);
        if (scriptPasteInput) scriptPasteInput.value = '';
        if (mobilePasteInput) mobilePasteInput.value = '';
        // Give the user a brief moment to see verified profile details before auto-closing
        setTimeout(() => {
          if (authModal && !authModal.classList.contains('hidden')) {
            authModal.classList.add('hidden');
          }
        }, 1500);
        if (state.selectedFrom && state.selectedTo) {
          executeSearch();
        }
      } else {
        showToast(data.error || 'Failed to save credentials.', 'error');
      }
    } catch (err) {
      showToast('Error saving credentials.', 'error');
    }
  }

  // Disconnect Token Handler
  if (disconnectTokenBtn) {
    disconnectTokenBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const token = getAuthToken();
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        updateAuthUI(false, null, null, null, null, false);
        showToast('Railway session disconnected.', 'success');
        if (trainsGrid) trainsGrid.innerHTML = '';
        if (trainsTableView) trainsTableView.classList.add('hidden');
        if (initialStateCard) initialStateCard.classList.remove('hidden');
        if (statsRibbon) statsRibbon.classList.add('hidden');
        if (trackerBar) trackerBar.classList.add('hidden');
      } catch (err) {
        console.warn('Logout error:', err);
        showToast('Failed to disconnect. Please try again.', 'error');
      }
    });
  }

  // ----------------------------------------------------
  // Dynamic Route Train Options Manager
  // ----------------------------------------------------
  // Dynamic Route Train & Class Filter Options Manager
  // ----------------------------------------------------
  let currentMainRouteTrains = [];
  let currentMainRouteClasses = [];
  let mainRouteAbortCtrl = null;

  function renderMainFilterClasses(classes, keepSelection = true) {
    if (!classFilterSelect) return;
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const prevVal = keepSelection ? classFilterSelect.value : 'ALL';
    const validClasses = Array.isArray(classes) && classes.length > 0
      ? classes
      : ['SNIGDHA', 'S_CHAIR', 'AC_S', 'AC_B', 'SHOVAN', 'SULOB', 'F_SEAT', 'F_BERTH', 'AC_CHAIR'];

    classFilterSelect.innerHTML = `<option value="ALL" data-i18n="all_classes">${isBn ? 'সব ক্লাস (All Classes)' : 'All Classes'}</option>`;

    validClasses.forEach(cls => {
      const displayName = window.i18n ? window.i18n.getSeatClassName(cls) : cls;
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = displayName.includes(cls) ? displayName : `${displayName} (${cls})`;
      classFilterSelect.appendChild(opt);
    });

    if (prevVal && classFilterSelect.querySelector(`option[value="${prevVal}"]`)) {
      classFilterSelect.value = prevVal;
      state.selectedClass = prevVal;
    } else {
      classFilterSelect.value = 'ALL';
      state.selectedClass = 'ALL';
    }
  }

  function renderMainFilterTrains(trainList, keepSelection = true) {
    if (!trainFilterSelect) return;
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const prevVal = keepSelection ? trainFilterSelect.value : 'ALL';
    trainFilterSelect.innerHTML = `<option value="ALL" data-i18n="all_trains">${isBn ? 'সব ট্রেন (All Trains)' : 'All Trains'}</option>`;

    const uniqueTrains = new Map();
    (Array.isArray(trainList) ? trainList : []).forEach(t => {
      const name = t.train_name || t.name;
      const code = t.train_model || t.model || t.code || '';
      if (name && !uniqueTrains.has(name)) {
        uniqueTrains.set(name, { code, classes: t.classes || [] });
      }
    });

    uniqueTrains.forEach((info, name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = info.code && !name.includes(info.code) ? `${name} (#${info.code})` : name;
      if (info.classes && info.classes.length > 0) {
        opt.dataset.classes = info.classes.join(',');
      }
      trainFilterSelect.appendChild(opt);
    });

    if (prevVal && trainFilterSelect.querySelector(`option[value="${prevVal}"]`)) {
      trainFilterSelect.value = prevVal;
      state.selectedTrain = prevVal;
    } else {
      trainFilterSelect.value = 'ALL';
      state.selectedTrain = 'ALL';
    }
  }

  function filterMainClassesForSelectedTrain() {
    const selectedTrain = trainFilterSelect?.value || 'ALL';
    if (selectedTrain === 'ALL') {
      renderMainFilterClasses(currentMainRouteClasses);
    } else {
      const found = currentMainRouteTrains.find(t => (t.train_name || t.name) === selectedTrain);
      if (found && Array.isArray(found.classes) && found.classes.length > 0) {
        renderMainFilterClasses(found.classes);
      } else {
        renderMainFilterClasses(currentMainRouteClasses);
      }
    }
  }

  async function updateMainRouteTrainsAndClasses() {
    const fromCity = (fromStationInput?.value || state.selectedFrom || '').trim();
    const toCity = (toStationInput?.value || state.selectedTo || '').trim();
    const doj = journeyDateInput?.value || state.selectedDate || '';

    if (!fromCity || !toCity) {
      currentMainRouteTrains = state.trainsCatalog || [];
      currentMainRouteClasses = ['SNIGDHA', 'S_CHAIR', 'AC_S', 'AC_B', 'SHOVAN', 'SULOB', 'F_SEAT', 'F_BERTH', 'AC_CHAIR'];
      renderMainFilterTrains(currentMainRouteTrains);
      renderMainFilterClasses(currentMainRouteClasses);
      return;
    }

    // 1. Instant local match from catalog
    const fromLower = fromCity.toLowerCase();
    const toLower = toCity.toLowerCase();
    const localMatches = (state.trainsCatalog || []).filter(t => {
      const f = String(t.from || '').toLowerCase();
      const to = String(t.to || '').toLowerCase();
      return (f.includes(fromLower) || fromLower.includes(f)) && (to.includes(toLower) || toLower.includes(to));
    });
    if (localMatches.length > 0) {
      currentMainRouteTrains = localMatches;
      renderMainFilterTrains(localMatches);
    }

    // If search is already executing or user has already populated filters, don't overwhelm server queue
    if (state.isLoading) return;

    // 2. Fetch live route trains & classes in background (aborts previous pending queries)
    if (mainRouteAbortCtrl) mainRouteAbortCtrl.abort();
    mainRouteAbortCtrl = new AbortController();

    try {
      const params = new URLSearchParams({
        from_city: fromCity,
        to_city: toCity,
        date_of_journey: doj
      });
      const res = await fetch(`/api/route-trains-classes?${params.toString()}`, {
        signal: mainRouteAbortCtrl.signal
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.trains) && json.trains.length > 0) {
          currentMainRouteTrains = json.trains;
          currentMainRouteClasses = Array.isArray(json.classes) && json.classes.length > 0
            ? json.classes
            : ['SNIGDHA', 'S_CHAIR', 'AC_S', 'AC_B', 'SHOVAN', 'SULOB', 'F_SEAT', 'F_BERTH', 'AC_CHAIR'];
          renderMainFilterTrains(currentMainRouteTrains);
          filterMainClassesForSelectedTrain();
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[MainSearch] Route trains fetch error:', e.message);
    }
  }

  function populateTrainFilterOptions(trainList) {
    if (Array.isArray(trainList) && trainList.length > 0) {
      currentMainRouteTrains = trainList.map(t => ({
        train_name: t.train_name,
        name: t.train_name,
        train_model: t.train_model,
        classes: (t.seat_types || []).map(s => s.type).filter(Boolean)
      }));
      const allSeatTypes = new Set();
      currentMainRouteTrains.forEach(t => (t.classes || []).forEach(c => allSeatTypes.add(c)));
      currentMainRouteClasses = Array.from(allSeatTypes);

      renderMainFilterTrains(currentMainRouteTrains);
      filterMainClassesForSelectedTrain();
    }
  }

  trainFilterSelect.addEventListener('change', (e) => {
    state.selectedTrain = e.target.value;
    filterMainClassesForSelectedTrain();
    if (state.lastSearchData) {
      renderResults(state.lastSearchData);
    }
  });

  classFilterSelect.addEventListener('change', (e) => {
    state.selectedClass = e.target.value;
    if (state.lastSearchData) {
      renderResults(state.lastSearchData);
    }
  });

  // ----------------------------------------------------
  // Desktop Notifications & Audio Alert System
  // ----------------------------------------------------

  function sendDesktopNotification(title, message, url) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body: message,
          icon: 'https://eticket.railway.gov.bd/favicon.ico',
          requireInteraction: true
        });
        notif.onclick = () => {
          window.focus();
          if (url) window.open(url, '_blank');
        };
      } catch (err) {
        console.warn('Desktop notification error:', err);
      }
    }
  }

  function showSeatReleaseBanner(info) {
    const { trainName, trainModel, className, seats, bookUrl, fromSoldOut } = info;
    if (releasedSeatAlertBanner && releasedSeatText && releasedSeatBookBtn) {
      if (fromSoldOut) {
        releasedSeatAlertBanner.className = 'bg-gradient-to-r from-rose-600 via-amber-600 to-emerald-600 text-white rounded-xl px-4 py-2.5 shadow-xl border border-amber-300/60 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in ring-2 ring-rose-500/40';
      } else {
        releasedSeatAlertBanner.className = 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white rounded-xl px-4 py-2.5 shadow-lg border border-emerald-400/50 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in';
      }

      releasedSeatText.innerHTML = `
        <div class="flex items-center flex-wrap gap-2 text-xs text-white">
          ${fromSoldOut ? `
            <span class="font-black bg-rose-500 text-white px-2 py-0.5 rounded-lg shadow-sm border border-rose-300 inline-flex items-center gap-1 whitespace-nowrap animate-pulse">
              <i class="fa-solid fa-bolt text-amber-300 text-[10px]"></i>
              <span>🚨 RELEASED!</span>
            </span>
          ` : `
            <span class="font-black bg-emerald-700 text-emerald-100 px-2 py-0.5 rounded-lg shadow-sm border border-emerald-500 inline-flex items-center gap-1 whitespace-nowrap">
              <i class="fa-solid fa-bell text-emerald-300 text-[10px]"></i>
              <span>SEATS AVAILABLE</span>
            </span>
          `}
          <span class="font-black bg-slate-900/80 text-white px-2.5 py-1 rounded-lg border border-white/20 shadow-xs inline-flex items-center gap-1.5 whitespace-nowrap">
            <i class="fa-solid fa-train text-emerald-400 text-[10px]"></i>
            <span>${trainName}</span>
            <span class="text-slate-300 font-mono text-[10px]">#${trainModel}</span>
          </span>
          <span class="font-black bg-amber-300 text-amber-950 px-2 py-0.5 rounded-lg shadow-sm border border-amber-400 inline-flex items-center gap-1 whitespace-nowrap">
            <i class="fa-solid fa-couch text-[9px] text-amber-800"></i>
            <span>${className}</span>
          </span>
          <span class="font-black ${fromSoldOut ? 'text-amber-100' : 'text-amber-200'} text-xs whitespace-nowrap">
            ${seats} Seat(s) Available to Buy!
          </span>
        </div>
      `;
      releasedSeatBookBtn.href = bookUrl;
      releasedSeatAlertBanner.classList.remove('hidden');
    }
  }

  // ----------------------------------------------------
  // Top Menu Notification Center (Historical Alert Storage)
  // ----------------------------------------------------
  function initNotificationCenter() {
    updateNotificationUI();

    if (notifBellBtn) {
      notifBellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = notifDropdown.classList.contains('hidden');
        if (settingsDropdown) settingsDropdown.classList.add('hidden');
        if (isHidden) {
          notifDropdown.classList.remove('hidden');
          // Mark all notifications as read when opening
          state.notifications.forEach(n => n.isRead = true);
          saveStoredNotifications();
          updateNotificationUI();
        } else {
          notifDropdown.classList.add('hidden');
        }
      });
    }

    const closeNotifModalBtn = document.getElementById('closeNotifModalBtn');
    if (closeNotifModalBtn) {
      closeNotifModalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (notifDropdown) notifDropdown.classList.add('hidden');
      });
    }

    if (notifDropdown) {
      notifDropdown.addEventListener('click', (e) => {
        // If clicking directly on the mobile backdrop outside the card, close the modal
        if (e.target === notifDropdown) {
          notifDropdown.classList.add('hidden');
        }
      });
    }

    // Close dropdown on outside click (desktop mode)
    document.addEventListener('click', (e) => {
      const mobileNavNotifBtn = document.getElementById('mobileNavNotifBtn');
      if (
        notifCenterContainer && 
        !notifCenterContainer.contains(e.target) && 
        !notifDropdown.contains(e.target) &&
        (!mobileNavNotifBtn || !mobileNavNotifBtn.contains(e.target))
      ) {
        if (notifDropdown) notifDropdown.classList.add('hidden');
      }
    });

    if (markAllReadBtn) {
      markAllReadBtn.addEventListener('click', () => {
        state.notifications.forEach(n => n.isRead = true);
        saveStoredNotifications();
        updateNotificationUI();
        showToast('All notifications marked as read', 'info');
      });
    }

    if (clearAllNotifsBtn) {
      clearAllNotifsBtn.addEventListener('click', () => {
        state.notifications = [];
        saveStoredNotifications();
        updateNotificationUI();
        showToast('Notification history cleared', 'info');
      });
    }

    if (testNotifBtn) {
      testNotifBtn.addEventListener('click', () => {
        const sampleTrain = state.lastSearchData?.trains?.[0] || {
          train_name: 'Suborno Express',
          train_model: '702'
        };
        const dojParam = formatShohozDoj(state.selectedDate || new Date().toISOString().split('T')[0]);
        const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, 'SNIGDHA');

        addStoredNotification({
          title: `🎉 Seat Alert (${sampleTrain.train_name})`,
          message: `49 new seat(s) released on ${sampleTrain.train_name} (#${sampleTrain.train_model}) for SNIGDHA!`,
          trainName: sampleTrain.train_name,
          trainModel: sampleTrain.train_model,
          className: 'SNIGDHA',
          seats: 49,
          fromCity: state.selectedFrom || 'Dhaka',
          toCity: state.selectedTo || 'Chattogram',
          date: dojParam,
          bookUrl: bookUrl,
          type: 'SEAT_RELEASED'
        });
        playUrgentAlertChime();
        showToast('Test notification stored in top menu!', 'success');
      });
    }
  }

  function saveStoredNotifications() {
    try {
      localStorage.setItem('railway_stored_alerts', JSON.stringify(state.notifications));
    } catch (e) {}
  }

  function addStoredNotification(notif) {
    const item = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      title: notif.title || 'Seat Alert',
      message: notif.message || '',
      trainName: notif.trainName || '',
      trainModel: notif.trainModel || '',
      className: notif.className || '',
      seats: notif.seats || 0,
      fromCity: notif.fromCity || state.selectedFrom || '',
      toCity: notif.toCity || state.selectedTo || '',
      date: notif.date || formatShohozDoj(state.selectedDate),
      bookUrl: notif.bookUrl || '#',
      timestamp: Date.now(),
      isRead: false,
      type: notif.type || 'SEAT_RELEASED'
    };

    state.notifications.unshift(item);
    if (state.notifications.length > 50) {
      state.notifications = state.notifications.slice(0, 50);
    }
    saveStoredNotifications();
    updateNotificationUI();
  }

  function updateNotificationUI() {
    const unreadCount = state.notifications.filter(n => !n.isRead).length;
    const totalCount = state.notifications.length;

    if (notifCountPill) notifCountPill.textContent = totalCount;
    if (notifBadge) {
      if (unreadCount > 0) {
        notifBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        notifBadge.classList.remove('hidden');
      } else {
        notifBadge.classList.add('hidden');
      }
    }

    const mobileNotifBadge = document.getElementById('mobileNotifBadge');
    if (mobileNotifBadge) {
      if (unreadCount > 0) {
        mobileNotifBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        mobileNotifBadge.classList.remove('hidden');
      } else {
        mobileNotifBadge.classList.add('hidden');
      }
    }

    renderNotificationsList();
  }

  function renderNotificationsList() {
    if (!notifListContainer) return;

    if (!state.notifications || state.notifications.length === 0) {
      notifListContainer.innerHTML = `
        <div class="py-8 px-4 text-center text-slate-400 space-y-2">
          <div class="w-10 h-10 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
            <i class="fa-regular fa-bell-slash text-base"></i>
          </div>
          <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">No Alert Notifications</p>
          <p class="text-[11px] text-slate-400 max-w-[220px] mx-auto">
            You will receive instant alerts here whenever booked seats become available to buy.
          </p>
        </div>
      `;
      return;
    }

    notifListContainer.innerHTML = state.notifications.map(item => {
      const isBn = window.i18n && window.i18n.getLang() === 'bn';
      const timeStr = formatRelativeTime(item.timestamp);
      const isRadarHit = item.type === 'RADAR_TARGET_HIT';
      const isSoldOutReleased = item.type === 'SOLD_OUT_RELEASED';
      const seatsFormatted = isBn ? `${window.i18n.toBnNum(item.seats)} সিট` : `${item.seats} Available`;
      const classNameFormatted = window.i18n ? window.i18n.getSeatClassName(item.className) : item.className;
      const tagLabel = isSoldOutReleased ? (isBn ? '🚨 সিট অবমুক্ত!' : '🚨 RELEASED!') : (isRadarHit ? (isBn ? '🎯 রাডার হিট' : '🎯 Radar Target') : (isBn ? '🟢 সিট অ্যালার্ট' : '🟢 Seat Alert'));

      return `
        <div class="p-3 sm:p-3.5 rounded-2xl transition-all ${
          item.isRead 
            ? 'bg-white/60 dark:bg-slate-900/60 opacity-85 border border-slate-200/60 dark:border-slate-800/60' 
            : isSoldOutReleased
              ? 'bg-gradient-to-r from-rose-50 to-amber-50/50 dark:from-rose-950/40 dark:to-slate-900 border-2 border-rose-300 dark:border-rose-800 shadow-sm'
              : isRadarHit 
                ? 'bg-gradient-to-r from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-slate-900 border-2 border-amber-300 dark:border-amber-800 shadow-xs' 
                : 'bg-emerald-50/60 dark:bg-emerald-950/30 border-2 border-emerald-300 dark:border-emerald-800'
        } flex items-start space-x-3 mb-2">
          
          <!-- Leading Icon -->
          <div class="w-9 h-9 rounded-2xl ${
            isSoldOutReleased
              ? 'bg-gradient-to-tr from-rose-600 to-amber-500 text-white shadow-xs'
              : isRadarHit 
                ? 'bg-gradient-to-tr from-amber-500 to-orange-600 text-white shadow-xs' 
                : 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xs'
          } flex items-center justify-center font-bold text-sm shrink-0 mt-0.5">
            <i class="fa-solid ${isSoldOutReleased ? 'fa-bolt animate-pulse' : (isRadarHit ? 'fa-crosshairs' : 'fa-bell')}"></i>
          </div>

          <div class="flex-1 min-w-0 space-y-1.5">
            <!-- Header with Title, Seats & Time -->
            <div class="flex items-center justify-between gap-1.5 flex-wrap">
              <div class="flex items-center space-x-1.5">
                <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                  isSoldOutReleased
                    ? 'bg-rose-600 text-white font-mono'
                    : isRadarHit 
                      ? 'bg-amber-500 text-amber-950 font-mono font-bold' 
                      : 'bg-emerald-600 text-white'
                }">${tagLabel}</span>
                <span class="text-[10px] text-slate-400 font-medium">${timeStr}</span>
              </div>

              ${item.seats ? `
                <span class="text-[11px] font-black px-2 py-0.5 rounded-full ${
                  isSoldOutReleased
                    ? 'text-rose-900 dark:text-rose-200 bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-700'
                    : isRadarHit 
                      ? 'text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-700' 
                      : 'text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-700'
                }">${seatsFormatted}</span>
              ` : ''}
            </div>

            <!-- Focused Highlights: Train Name & Seat Class -->
            <div class="flex items-center flex-wrap gap-1.5">
              <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-black shadow-xs">
                <i class="fa-solid fa-train text-[10px] ${isSoldOutReleased ? 'text-amber-300' : (isRadarHit ? 'text-amber-400' : 'text-emerald-400')}"></i>
                <span>${item.trainName || 'Intercity Train'}</span>
                ${item.trainModel ? `<span class="text-slate-400 font-mono text-[10px]">#${item.trainModel}</span>` : ''}
              </span>

              <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 font-black text-xs">
                <i class="fa-solid fa-couch text-[9px] text-emerald-600 dark:text-emerald-400"></i>
                <span>${classNameFormatted || 'Seat Class'}</span>
              </span>
            </div>

            <!-- Route Info & Direct Booking Button -->
            <div class="flex items-center justify-between pt-1 gap-2">
              <span class="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                ${item.fromCity && item.toCity ? `${item.fromCity} ➔ ${item.toCity} &bull; ${item.date}` : item.date}
              </span>

              ${item.bookUrl && item.bookUrl !== '#' ? `
                <a href="${item.bookUrl}" target="_blank" rel="noopener" class="px-3 py-1 rounded-xl ${
                  isSoldOutReleased
                    ? 'bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-700 hover:to-amber-700 text-white'
                    : isRadarHit 
                      ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white' 
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                } font-black text-[11px] shadow-sm inline-flex items-center space-x-1 transition active:scale-95 shrink-0">
                  <span>${isBn ? 'টিকিট কাটুন' : 'Book'}</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ----------------------------------------------------
  // Sound Alerts via Web Audio API
  // 1. Normal Seat Release (Pleasant Melodious Railway Bell)
  // 2. Available from ALL SOLD OUT (Urgent Energetic Triple-Burst Alarm)
  // 3. Watchlist Radar Target Hit (High-Priority Sonar Sweep)
  // ----------------------------------------------------
  
  // 🎵 Alert 1: Normal Route Seat Release Chime (Gentle D5 -> A5 Melodious Bell)
  function playNormalSeatReleaseSound() {
    if (!state.isSoundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;

      // Note 1: D5 (587.33 Hz)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: A5 (880.00 Hz)
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, now + 0.14);
      gain2.gain.setValueAtTime(0.25, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.65);
    } catch (e) {
      console.warn('Normal audio alert error:', e);
    }
  }

  // 🚨 Alert 2: Available Seat from ALL SOLD OUT (Urgent Ascending Triple-Burst Alarm)
  function playSoldOutReleasedSound() {
    if (!state.isSoundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;

      // Ascending rapid alert bursts: G5 -> C6 -> E6 -> G6 -> C7
      const freqs = [783.99, 1046.50, 1318.51, 1567.98, 2093.00];
      freqs.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + idx * 0.055);
        gain.gain.setValueAtTime(0.25, now + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.20);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.20);
      });

      // High resonant echo pings (C7: 2093 Hz)
      const echoTimes = [0.32, 0.44];
      echoTimes.forEach(t => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2093.00, now + t);
        gain.gain.setValueAtTime(0.3, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.22);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.22);
      });
    } catch (e) {
      console.warn('Sold-out released audio alert error:', e);
    }
  }

  // 🎯 Alert 3: Watchlist Radar Target Hit Alarm (High-Priority Sonar/Radar Arpeggio)
  function playRadarTargetHitSound() {
    if (!state.isSoundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;

      // Pulse 1: Fast Rising 4-Tone Sonar Sweep (C5 -> G5 -> C6 -> E6)
      const notes = [523.25, 783.99, 1046.50, 1318.51];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.28, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.28);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.28);
      });

      // Pulse 2: High-Pitched Resonant Radar Ping Echoes (1760 Hz A6)
      const echoTimes = [0.36, 0.48];
      echoTimes.forEach(t => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1760.00, now + t);
        gain.gain.setValueAtTime(0.3, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.22);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.22);
      });
    } catch (e) {
      console.warn('Radar audio alert error:', e);
    }
  }

  // Alias for backward compatibility
  function playNotificationChime() {
    playNormalSeatReleaseSound();
  }

  function playUrgentAlertChime() {
    playSoldOutReleasedSound();
  }

  // ----------------------------------------------------
  // ----------------------------------------------------
  // 📱 Mobile App Push Notifications & Dynamic Island Banners
  // ----------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-600/95 dark:bg-emerald-700/95 text-white border-emerald-400/40 shadow-emerald-950/20',
      error: 'bg-rose-600/95 dark:bg-rose-700/95 text-white border-rose-400/40 shadow-rose-950/20',
      info: 'bg-slate-900/95 dark:bg-slate-800/95 text-white border-slate-700/50 shadow-slate-950/20'
    };
    const icons = {
      success: 'fa-circle-check text-emerald-300',
      error: 'fa-triangle-exclamation text-rose-300',
      info: 'fa-circle-info text-cyan-300'
    };

    toast.className = `flex items-center space-x-3 px-4 py-3 rounded-2xl shadow-xl backdrop-blur-md border text-xs font-semibold ${bgColors[type] || bgColors.info} animate-app-push pointer-events-auto transition-all`;
    toast.innerHTML = `
      <div class="w-7 h-7 rounded-xl bg-white/15 flex items-center justify-center text-xs shrink-0 shadow-2xs">
        <i class="fa-solid ${icons[type] || icons.info}"></i>
      </div>
      <div class="flex-1 min-w-0 font-bold">${message}</div>
      <button type="button" class="w-6 h-6 rounded-full hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition cursor-pointer shrink-0 ml-1">
        <i class="fa-solid fa-xmark text-xs"></i>
      </button>
    `;

    // Dismiss on click
    const closeBtn = toast.querySelector('button');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 250);
      });
    }

    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        setTimeout(() => toast.remove(), 300);
      }
    }, 5000);
  }

  // 🚨 Specialized Sold Out -> Available Native In-App Push Banner
  function showSoldOutReleasedToast(trainName, className, seats, bookUrl) {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const seatsFormatted = isBn ? `${window.i18n.toBnNum(seats)} টি সিট` : `${seats} seat(s)`;
    const classFormatted = window.i18n ? window.i18n.getSeatClassName(className) : className;
    const toast = document.createElement('div');
    toast.className = 'flex items-center justify-between gap-2.5 px-3.5 sm:px-4 py-3 rounded-2xl sm:rounded-3xl shadow-2xl bg-gradient-to-r from-rose-950/95 via-slate-900/95 to-slate-900/95 text-white text-xs font-bold ring-2 ring-rose-500/80 backdrop-blur-md animate-app-push pointer-events-auto border border-rose-500/40';
    toast.innerHTML = `
      <div class="flex items-center space-x-2.5 min-w-0 flex-1">
        <div class="w-9 h-9 rounded-2xl bg-gradient-to-tr from-rose-600 to-amber-500 text-white flex items-center justify-center text-sm shadow-md shrink-0 animate-bounce">
          <i class="fa-solid fa-bolt text-amber-200"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center space-x-1.5 flex-wrap">
            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded-md bg-rose-600 text-white font-mono shadow-2xs">${isBn ? '🚨 সিট অবমুক্ত!' : '🚨 RELEASED!'}</span>
            <span class="font-extrabold text-white truncate text-xs">${trainName}</span>
          </div>
          <p class="text-[11px] text-rose-200 font-medium truncate mt-0.5">
            <span class="font-black text-amber-300 underline">${seatsFormatted}</span> ${isBn ? 'পাওয়া যাচ্ছে' : 'released in'} <span class="font-black text-white">${classFormatted}</span>!
          </p>
        </div>
      </div>
      <div class="flex items-center space-x-1.5 shrink-0">
        ${bookUrl && bookUrl !== '#' ? `
          <a href="${bookUrl}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-black text-xs shadow-md transition shrink-0 inline-flex items-center space-x-1 active:scale-95">
            <span>${isBn ? 'কাটুন' : 'Book'}</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        ` : ''}
        <button type="button" class="w-6 h-6 rounded-full hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition cursor-pointer">
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>
    `;

    const closeBtn = toast.querySelector('button');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 250);
      });
    }

    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        setTimeout(() => toast.remove(), 300);
      }
    }, 7500);
  }

  // 🎯 Specialized Watchlist Radar Hit Native In-App Push Banner
  function showRadarHitToast(trainName, className, seats, bookUrl) {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const seatsFormatted = isBn ? `${window.i18n.toBnNum(seats)} টি সিট` : `${seats} seat(s)`;
    const classFormatted = window.i18n ? window.i18n.getSeatClassName(className) : className;
    const toast = document.createElement('div');
    toast.className = 'flex items-center justify-between gap-2.5 px-3.5 sm:px-4 py-3 rounded-2xl sm:rounded-3xl shadow-2xl bg-gradient-to-r from-amber-950/95 via-slate-900/95 to-slate-900/95 text-white text-xs font-bold ring-2 ring-amber-400/80 backdrop-blur-md animate-app-push pointer-events-auto border border-amber-400/40';
    toast.innerHTML = `
      <div class="flex items-center space-x-2.5 min-w-0 flex-1">
        <div class="w-9 h-9 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white flex items-center justify-center text-sm shadow-md shrink-0">
          <i class="fa-solid fa-crosshairs animate-spin text-amber-200"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center space-x-1.5 flex-wrap">
            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded-md bg-amber-500 text-amber-950 font-mono shadow-2xs">${isBn ? '🎯 রাডার হিট' : '🎯 RADAR HIT'}</span>
            <span class="font-extrabold text-white truncate text-xs">${trainName}</span>
          </div>
          <p class="text-[11px] text-amber-200 font-medium truncate mt-0.5">
            <span class="font-black text-white underline">${seatsFormatted}</span> ${isBn ? 'উপলব্ধ' : 'available in'} <span class="font-black text-amber-300">${classFormatted}</span>!
          </p>
        </div>
      </div>
      <div class="flex items-center space-x-1.5 shrink-0">
        ${bookUrl && bookUrl !== '#' ? `
          <a href="${bookUrl}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-slate-950 font-black text-xs shadow-md transition shrink-0 inline-flex items-center space-x-1 active:scale-95">
            <span>${isBn ? 'কাটুন' : 'Book'}</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        ` : ''}
        <button type="button" class="w-6 h-6 rounded-full hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition cursor-pointer">
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>
    `;

    const closeBtn = toast.querySelector('button');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 250);
      });
    }

    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        setTimeout(() => toast.remove(), 300);
      }
    }, 7000);
  }

  // ----------------------------------------------------
  // Date Picker & Quick Day Shortcuts
  // ----------------------------------------------------
  // Helper to format Date object into local YYYY-MM-DD string
  function getLocalDateIso(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function setupDateLimits() {
    const today = new Date();
    const maxDate = new Date(today);
    // 10 days advance ticket without today (Today + 10 calendar days ahead)
    maxDate.setDate(today.getDate() + 10);

    const todayFormatted = getLocalDateIso(today);
    const maxDateFormatted = getLocalDateIso(maxDate);

    journeyDateInput.min = todayFormatted;
    journeyDateInput.max = maxDateFormatted;
    if (!journeyDateInput.value || journeyDateInput.value < todayFormatted || journeyDateInput.value > maxDateFormatted) {
      journeyDateInput.value = todayFormatted;
      state.selectedDate = todayFormatted;
    }

    if (matrixStartDateInput) {
      matrixStartDateInput.min = todayFormatted;
      matrixStartDateInput.max = maxDateFormatted;
      if (!matrixStartDateInput.value) {
        matrixStartDateInput.value = todayFormatted;
      }
    }
  }

  function generateQuickDateChips() {
    dateChipsContainer.querySelectorAll('.date-chip').forEach(c => c.remove());
    const today = new Date();
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysBn = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];
    const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsBn = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];

    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      
      let label;
      if (i === 0) {
        label = isBn ? 'আজ' : 'Today';
      } else if (i === 1) {
        label = isBn ? 'আগামীকাল' : 'Tomorrow';
      } else {
        const dayName = isBn ? daysBn[d.getDay()] : daysEn[d.getDay()];
        const dayNum = isBn ? (window.i18n ? window.i18n.toBnNum(d.getDate()) : d.getDate()) : d.getDate();
        const monthName = isBn ? monthsBn[d.getMonth()] : monthsEn[d.getMonth()];
        label = `${dayName} (${dayNum} ${monthName})`;
      }

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `date-chip px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap shrink-0 cursor-pointer active:scale-95 shadow-2xs ${
        i === 0 
          ? 'bg-emerald-700 text-white shadow-xs border border-emerald-700 font-semibold' 
          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
      }`;
      chip.textContent = label;
      chip.dataset.date = iso;

      chip.addEventListener('click', () => {
        journeyDateInput.value = iso;
        state.selectedDate = iso;
        updateActiveDateChips(iso);
        updateMainRouteTrainsAndClasses();
        if (state.selectedFrom && state.selectedTo) {
          executeSearch();
        }
      });

      dateChipsContainer.appendChild(chip);
    }
  }

  function updateActiveDateChips(selectedIso) {
    dateChipsContainer.querySelectorAll('.date-chip').forEach(chip => {
      if (chip.dataset.date === selectedIso) {
        chip.className = 'date-chip px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-700 text-white shadow-xs border border-emerald-700 transition whitespace-nowrap shrink-0 cursor-pointer active:scale-95';
      } else {
        chip.className = 'date-chip px-2.5 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 transition whitespace-nowrap shrink-0 cursor-pointer active:scale-95';
      }
    });
  }

  journeyDateInput.addEventListener('change', (e) => {
    state.selectedDate = e.target.value;
    updateActiveDateChips(e.target.value);
    updateMainRouteTrainsAndClasses();
  });
  journeyDateInput.addEventListener('input', (e) => {
    state.selectedDate = e.target.value;
    updateActiveDateChips(e.target.value);
    updateMainRouteTrainsAndClasses();
  });

  // ----------------------------------------------------
  // Station Autocomplete & Management (256 Shohoz Stations)
  // ----------------------------------------------------
  async function fetchStations() {
    try {
      const res = await fetch('/api/stations');
      const data = await res.json();
      if (data && data.stations) {
        state.stations = data.stations;
      }
    } catch (err) {
      console.error('Failed to load stations:', err);
    }
  }

  async function fetchTrainsCatalog() {
    try {
      const res = await fetch('/api/trains-list');
      const data = await res.json();
      if (data && data.trains) {
        state.trainsCatalog = data.trains;
        window.dispatchEvent(new CustomEvent('trainsCatalogLoaded'));
      }
    } catch (err) {
      console.error('Failed to load trains catalog:', err);
    }
  }

  function setupAutocomplete(inputEl, dropdownEl, clearBtn, onSelect) {
    inputEl.addEventListener('input', () => {
      const query = inputEl.value.trim().toLowerCase();
      clearBtn.classList.toggle('hidden', !query);

      if (!query) {
        dropdownEl.classList.add('hidden');
        dropdownEl.innerHTML = '';
        return;
      }

      // Check for alias match first (e.g. airport -> Biman_Bandar, ctg -> Chattogram)
      let aliasMatches = [];
      if (STATION_ALIASES[query]) {
        const canonical = STATION_ALIASES[query];
        const sObj = state.stations.find(s => s.name.toLowerCase() === canonical.toLowerCase());
        if (sObj) aliasMatches.push(sObj);
      }

      const otherMatches = state.stations.filter(s => {
        const bnTranslated = window.i18n ? window.i18n.getStationName(s.name, 'bn') : '';
        return (
          s.name.toLowerCase().includes(query) ||
          (s.display_name && s.display_name.toLowerCase().includes(query)) ||
          (s.bn_name && s.bn_name.includes(query)) ||
          (bnTranslated && bnTranslated.includes(query)) ||
          (s.alias && s.alias.toLowerCase().includes(query))
        );
      });

      const matches = Array.from(new Set([...aliasMatches, ...otherMatches])).slice(0, 15);

      renderDropdownItems(matches, dropdownEl, inputEl, onSelect);
    });

    inputEl.addEventListener('focus', () => {
      if (inputEl.value.trim()) {
        inputEl.dispatchEvent(new Event('input'));
      }
    });

    clearBtn.addEventListener('click', () => {
      inputEl.value = '';
      clearBtn.classList.add('hidden');
      dropdownEl.classList.add('hidden');
      onSelect('');
      inputEl.focus();
    });

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        dropdownEl.classList.add('hidden');
      }
    });
  }

  function renderDropdownItems(items, dropdownEl, inputEl, onSelect) {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';

    if (items.length === 0) {
      dropdownEl.innerHTML = `
        <div class="px-4 py-3 text-xs text-slate-400 text-center">
          ${isBn ? 'কোনো স্টেশন খুঁজে পাওয়া যায়নি' : 'No matching Shohoz station found'}
        </div>
      `;
      dropdownEl.classList.remove('hidden');
      return;
    }

    dropdownEl.innerHTML = items.map(s => {
      const bnName = (s.bn_name && s.bn_name !== s.name) ? s.bn_name : '';
      // Primary title is always canonical English name; show Bangla secondary hint only if available
      const primaryTitle = s.display_name || s.name;
      const secondaryTitle = bnName;
      return `
        <div class="autocomplete-item px-3.5 py-2.5 cursor-pointer flex items-center justify-between text-xs transition hover:bg-emerald-50/80 dark:hover:bg-slate-700/60" data-name="${s.name}" data-display="${primaryTitle}">
          <div class="flex items-center space-x-2 min-w-0">
            <i class="fa-solid fa-location-dot text-emerald-500 text-[11px] shrink-0"></i>
            <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${primaryTitle}</span>
            ${secondaryTitle ? `<span class="text-slate-400 font-medium text-[11px] truncate">(${secondaryTitle})</span>` : ''}
          </div>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold shrink-0 ml-2">${s.name}</span>
        </div>
      `;
    }).join('');

    dropdownEl.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const canonical = item.dataset.name;
        // Origin and Destination input must strictly stay in English
        inputEl.value = canonical;
        dropdownEl.classList.add('hidden');
        onSelect(canonical);
      });
    });

    dropdownEl.classList.remove('hidden');
  }

  setupAutocomplete(fromStationInput, fromDropdown, clearFromBtn, (name) => {
    state.selectedFrom = name;
    updateMainRouteTrainsAndClasses();
  });
  fromStationInput.addEventListener('change', () => updateMainRouteTrainsAndClasses());
  fromStationInput.addEventListener('blur', () => updateMainRouteTrainsAndClasses());

  setupAutocomplete(toStationInput, toDropdown, clearToBtn, (name) => {
    state.selectedTo = name;
    updateMainRouteTrainsAndClasses();
  });
  toStationInput.addEventListener('change', () => updateMainRouteTrainsAndClasses());
  toStationInput.addEventListener('blur', () => updateMainRouteTrainsAndClasses());

  swapStationsBtn.addEventListener('click', () => {
    const tempVal = fromStationInput.value;
    fromStationInput.value = toStationInput.value;
    toStationInput.value = tempVal;

    state.selectedFrom = fromStationInput.value;
    state.selectedTo = toStationInput.value;

    clearFromBtn.classList.toggle('hidden', !fromStationInput.value);
    clearToBtn.classList.toggle('hidden', !toStationInput.value);
    swapIcon.classList.toggle('rotate-180');

    updateMainRouteTrainsAndClasses();

    if (state.selectedFrom && state.selectedTo) {
      executeSearch();
    }
  });

  if (journeyDateInput) {
    journeyDateInput.addEventListener('change', () => updateMainRouteTrainsAndClasses());
  }

  updateMainRouteTrainsAndClasses();
  window.addEventListener('trainsCatalogLoaded', () => updateMainRouteTrainsAndClasses());

  // ----------------------------------------------------
  // Popular / Custom Quick Routes System
  // ----------------------------------------------------
  async function loadPopularRoutesFromServer() {
    try {
      const res = await fetch('/api/user-auth/popular-routes', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('railway_auth_token') || ''}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.routes) && data.routes.length > 0) {
          state.popularRoutes = data.routes;
          localStorage.setItem('rail_custom_popular_routes', JSON.stringify(state.popularRoutes));
        }
      }
    } catch (e) {
      console.warn('[PopularRoutes] Failed to sync from server:', e.message);
    }
    renderPopularRoutes();
    renderProfilePopularRoutes();
  }

  async function savePopularRoutes(routes) {
    state.popularRoutes = routes;
    try {
      localStorage.setItem('rail_custom_popular_routes', JSON.stringify(routes));
    } catch (e) {}

    renderPopularRoutes();
    renderProfilePopularRoutes();

    if (state.currentUser) {
      try {
        await fetch('/api/user-auth/popular-routes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('railway_auth_token') || ''}`
          },
          body: JSON.stringify({ routes })
        });
      } catch (e) {
        console.warn('[PopularRoutes] Failed to save to server:', e.message);
      }
    }
  }

  function renderPopularRoutes() {
    if (!popularRoutesContainer) return;
    if (!state.popularRoutes || state.popularRoutes.length === 0) {
      popularRoutesContainer.innerHTML = `<span class="text-[10px] text-slate-400 italic">No quick routes saved.</span>`;
      return;
    }

    popularRoutesContainer.innerHTML = state.popularRoutes.map(r => {
      const isSelected = (state.selectedFrom && state.selectedTo && 
        state.selectedFrom.toLowerCase() === r.from.toLowerCase() && 
        state.selectedTo.toLowerCase() === r.to.toLowerCase());

      const activeClass = isSelected
        ? 'bg-emerald-700 text-white border-emerald-700 font-semibold shadow-xs'
        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400';

      return `
        <button type="button" class="quick-route-chip px-2.5 py-1 rounded-md text-xs font-medium border transition-all cursor-pointer shrink-0 active:scale-95 shadow-2xs ${activeClass}" 
          data-from="${r.from}" data-to="${r.to}">
          ${r.label || `${r.from} ⇄ ${r.to}`}
        </button>
      `;
    }).join('');

    popularRoutesContainer.querySelectorAll('.quick-route-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const from = chip.dataset.from;
        const to = chip.dataset.to;
        fromStationInput.value = from;
        toStationInput.value = to;
        state.selectedFrom = from;
        state.selectedTo = to;
        clearFromBtn.classList.remove('hidden');
        clearToBtn.classList.remove('hidden');

        renderPopularRoutes();
        updateMainRouteTrainsAndClasses();
        executeSearch();
      });
    });
  }

  function renderProfilePopularRoutes() {
    if (!profileSavedRoutesList) return;
    if (savedRoutesCountBadge) {
      savedRoutesCountBadge.textContent = `${state.popularRoutes.length} route${state.popularRoutes.length === 1 ? '' : 's'}`;
    }

    if (!state.popularRoutes || state.popularRoutes.length === 0) {
      profileSavedRoutesList.innerHTML = `<p class="text-[11px] text-slate-400 p-2 italic w-full text-center">No saved routes yet. Add your frequent stations below.</p>`;
      return;
    }

    profileSavedRoutesList.innerHTML = state.popularRoutes.map((r, idx) => `
      <div class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-bold shadow-2xs">
        <span class="text-slate-800 dark:text-slate-200 font-mono">${r.from} ➔ ${r.to}</span>
        <button type="button" class="delete-popular-route-btn text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 p-0.5 rounded-full transition cursor-pointer ml-1" data-idx="${idx}" title="Delete ${r.from} ➔ ${r.to}">
          <i class="fa-solid fa-xmark text-[10px]"></i>
        </button>
      </div>
    `).join('');

    profileSavedRoutesList.querySelectorAll('.delete-popular-route-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        if (!isNaN(idx) && idx >= 0 && idx < state.popularRoutes.length) {
          const removed = state.popularRoutes[idx];
          const newRoutes = state.popularRoutes.filter((_, i) => i !== idx);
          savePopularRoutes(newRoutes);
          showToast(`Deleted ${removed.from} ⇄ ${removed.to} from Quick Select.`, 'info');
        }
      });
    });
  }

  function setupProfileStationSuggest(inputEl, dropdownEl) {
    if (!inputEl || !dropdownEl) return;
    inputEl.addEventListener('input', () => {
      const query = inputEl.value.trim().toLowerCase();
      if (!query) {
        dropdownEl.classList.add('hidden');
        dropdownEl.innerHTML = '';
        return;
      }
      let aliasMatches = [];
      if (STATION_ALIASES[query]) {
        const canonical = STATION_ALIASES[query];
        const sObj = state.stations.find(s => s.name.toLowerCase() === canonical.toLowerCase());
        if (sObj) aliasMatches.push(sObj);
      }
      const otherMatches = state.stations.filter(s =>
        s.name.toLowerCase().includes(query) ||
        (s.display_name && s.display_name.toLowerCase().includes(query))
      );
      const matches = Array.from(new Set([...aliasMatches, ...otherMatches])).slice(0, 8);
      if (matches.length === 0) {
        dropdownEl.classList.add('hidden');
        return;
      }
      dropdownEl.innerHTML = matches.map(s => `
        <div class="px-2.5 py-1.5 cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-800 flex items-center justify-between text-xs transition" data-name="${s.name}">
          <span class="font-bold text-slate-800 dark:text-slate-100">${s.name}</span>
          <span class="text-[10px] text-slate-400 font-mono">${s.display_name || ''}</span>
        </div>
      `).join('');
      dropdownEl.classList.remove('hidden');
      dropdownEl.querySelectorAll('div[data-name]').forEach(item => {
        item.addEventListener('click', () => {
          inputEl.value = item.dataset.name;
          dropdownEl.classList.add('hidden');
        });
      });
    });
    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        dropdownEl.classList.add('hidden');
      }
    });
  }

  setupProfileStationSuggest(addRouteFromInput, addRouteFromSuggest);
  setupProfileStationSuggest(addRouteToInput, addRouteToSuggest);

  if (addNewCustomRouteBtn) {
    addNewCustomRouteBtn.addEventListener('click', () => {
      const rawFrom = addRouteFromInput ? addRouteFromInput.value.trim() : '';
      const rawTo = addRouteToInput ? addRouteToInput.value.trim() : '';
      const from = getCanonicalStationName(rawFrom);
      const to = getCanonicalStationName(rawTo);

      if (!from || !to) {
        showToast('Please specify both From and To stations.', 'error');
        return;
      }
      if (from.toLowerCase() === to.toLowerCase()) {
        showToast('Departure and destination stations cannot be identical.', 'error');
        return;
      }

      const exists = state.popularRoutes.some(r => 
        r.from.toLowerCase() === from.toLowerCase() && r.to.toLowerCase() === to.toLowerCase()
      );
      if (exists) {
        showToast(`Route ${from} ⇄ ${to} is already in your Quick Select list.`, 'warning');
        return;
      }

      const newRoute = { from, to, label: `${from} ⇄ ${to}` };
      const newRoutes = [...state.popularRoutes, newRoute];
      savePopularRoutes(newRoutes);

      if (addRouteFromInput) addRouteFromInput.value = '';
      if (addRouteToInput) addRouteToInput.value = '';
      showToast(`Added ${from} ⇄ ${to} to Quick Select!`, 'success');
    });
  }

  if (resetDefaultRoutesBtn) {
    resetDefaultRoutesBtn.addEventListener('click', () => {
      const defaultRoutes = [
        { from: 'Dhaka', to: 'Chattogram', label: 'Dhaka ⇄ Ctg' },
        { from: 'Dhaka', to: "Cox's Bazar", label: "Dhaka ⇄ Cox's Bazar" },
        { from: 'Dhaka', to: 'Sylhet', label: 'Dhaka ⇄ Sylhet' },
        { from: 'Dhaka', to: 'Rajshahi', label: 'Dhaka ⇄ Rajshahi' },
        { from: 'Dhaka', to: 'Khulna', label: 'Dhaka ⇄ Khulna' },
        { from: 'Dhaka', to: 'Rangpur', label: 'Dhaka ⇄ Rangpur' }
      ];
      savePopularRoutes(defaultRoutes);
      showToast('Restored default Bangladesh popular routes.', 'info');
    });
  }

  if (saveCurrentRouteChipBtn) {
    saveCurrentRouteChipBtn.addEventListener('click', () => {
      const rawFrom = fromStationInput ? fromStationInput.value.trim() : '';
      const rawTo = toStationInput ? toStationInput.value.trim() : '';
      const from = state.selectedFrom || getCanonicalStationName(rawFrom);
      const to = state.selectedTo || getCanonicalStationName(rawTo);

      if (!from || !to) {
        showToast('Please select From and To stations on the search card first.', 'warning');
        return;
      }
      if (from.toLowerCase() === to.toLowerCase()) {
        showToast('Departure and destination stations cannot be identical.', 'error');
        return;
      }

      const exists = state.popularRoutes.some(r => 
        r.from.toLowerCase() === from.toLowerCase() && r.to.toLowerCase() === to.toLowerCase()
      );
      if (exists) {
        showToast(`Route ${from} ⇄ ${to} is already in your Quick Select list.`, 'info');
        return;
      }

      const newRoute = { from, to, label: `${from} ⇄ ${to}` };
      const newRoutes = [...state.popularRoutes, newRoute];
      savePopularRoutes(newRoutes);
      showToast(`Saved ${from} ⇄ ${to} to Quick Select!`, 'success');
    });
  }

  if (managePopularRoutesBtn) {
    managePopularRoutesBtn.addEventListener('click', () => {
      if (quickRoutesManagerDrawer) {
        const isClosed = quickRoutesManagerDrawer.classList.contains('hidden');
        quickRoutesManagerDrawer.classList.toggle('hidden');
        if (isClosed) {
          renderProfilePopularRoutes();
          if (addRouteFromInput) addRouteFromInput.focus();
        }
      }
    });
  }

  if (closeRouteManagerBtn) {
    closeRouteManagerBtn.addEventListener('click', () => {
      if (quickRoutesManagerDrawer) {
        quickRoutesManagerDrawer.classList.add('hidden');
      }
    });
  }

  // ----------------------------------------------------
  // Search & API Execution (Fast Direct Search by Default, On-Demand Deep Search)
  // ----------------------------------------------------
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawFrom = fromStationInput.value.trim();
    const rawTo = toStationInput.value.trim();
    state.selectedFrom = getCanonicalStationName(rawFrom);
    state.selectedTo = getCanonicalStationName(rawTo);
    fromStationInput.value = state.selectedFrom;
    toStationInput.value = state.selectedTo;
    state.selectedDate = journeyDateInput ? journeyDateInput.value : '';

    if (!state.selectedDate) {
      const today = new Date();
      state.selectedDate = getLocalDateIso(today);
      if (journeyDateInput) journeyDateInput.value = state.selectedDate;
    }

    if (!state.selectedFrom || !state.selectedTo) {
      showToast('Please select both departure and destination stations.', 'error');
      return;
    }

    if (state.selectedFrom.toLowerCase() === state.selectedTo.toLowerCase()) {
      showToast('Departure and Destination stations cannot be the same.', 'error');
      return;
    }

    // Default fast direct search (checkAlternates = false to reduce server API queries)
    executeSearch(false, false);
  });

  // Deep Search Button (Explicitly queries Same-Train Stoppages & Junction Alternate Routes)
  if (deepSearchSubmitBtn) {
    deepSearchSubmitBtn.addEventListener('click', () => {
      const rawFrom = fromStationInput.value.trim();
      const rawTo = toStationInput.value.trim();
      state.selectedFrom = getCanonicalStationName(rawFrom);
      state.selectedTo = getCanonicalStationName(rawTo);
      fromStationInput.value = state.selectedFrom;
      toStationInput.value = state.selectedTo;
      state.selectedDate = journeyDateInput ? journeyDateInput.value : '';

      if (!state.selectedDate) {
        const today = new Date();
        state.selectedDate = getLocalDateIso(today);
        if (journeyDateInput) journeyDateInput.value = state.selectedDate;
      }

      if (!state.selectedFrom || !state.selectedTo) {
        showToast('Please select both departure and destination stations.', 'error');
        return;
      }

      if (state.selectedFrom.toLowerCase() === state.selectedTo.toLowerCase()) {
        showToast('Departure and Destination stations cannot be the same.', 'error');
        return;
      }

      // Explicit Deep Search request
      executeSearch(false, true);
    });
  }

  manualRefreshBtn.addEventListener('click', () => {
    if (!state.selectedFrom || !state.selectedTo) return;
    refreshIcon.classList.add('animate-spin-fast');
    executeSearch(false, false).finally(() => {
      setTimeout(() => refreshIcon.classList.remove('animate-spin-fast'), 600);
    });
  });

  async function executeSearch(isSilent = false, checkAlternates = false) {
    if (state.isLoading) return;

    if (!state.isAuthenticated) {
      showToast('Please connect your Live API session to search real-time seats.', 'info');
      authModal.classList.remove('hidden');
      return;
    }

    if (!state.selectedFrom || !state.selectedTo) {
      if (!isSilent) showToast('Please select departure and destination stations.', 'error');
      return;
    }

    if (!state.selectedDate) {
      const today = new Date();
      state.selectedDate = getLocalDateIso(today);
      if (journeyDateInput) journeyDateInput.value = state.selectedDate;
    }

    state.isLoading = true;

    if (!isSilent) {
      initialStateCard.classList.add('hidden');
      loadingIndicator.classList.remove('hidden');
      trainsGrid.innerHTML = '';
      trainsTableView.classList.add('hidden');
      if (alternateRoutesContainer) {
        alternateRoutesContainer.classList.add('hidden');
        alternateRoutesContainer.innerHTML = '';
      }

      if (checkAlternates && deepSearchSubmitBtn) {
        deepSearchSubmitBtn.disabled = true;
        deepSearchSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-xs"></i><span class="whitespace-nowrap">Deep Scanning...</span>';
        searchSubmitBtn.disabled = true;
      } else {
        searchSubmitBtn.disabled = true;
        searchSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-xs"></i><span class="whitespace-nowrap">Finding Train...</span>';
        if (deepSearchSubmitBtn) deepSearchSubmitBtn.disabled = true;
      }

      // Smooth auto-scroll down to loading / results section so user immediately sees search feedback
      try {
        const scrollTarget = document.getElementById('loadingIndicator') || document.getElementById('resultsContainer') || document.getElementById('trackerBar');
        if (scrollTarget) {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (scrollErr) {
        console.warn('Auto-scroll start error:', scrollErr);
      }
    }

    let data = null;
    try {
      const token = getAuthToken();
      const url = `/api/search?from_city=${encodeURIComponent(state.selectedFrom)}&to_city=${encodeURIComponent(state.selectedTo)}&date_of_journey=${encodeURIComponent(state.selectedDate)}&check_alternates=${checkAlternates ? 'true' : 'false'}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);

      const headers = { 'Accept': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-shohoz-token'] = token;
      }

      const res = await fetch(url, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const rawText = await res.text();
        try {
          data = JSON.parse(rawText);
        } catch (jsonErr) {
          if (!res.ok) {
            throw new Error(`Server returned HTTP ${res.status}: ${res.statusText || 'Gateway error'}`);
          }
          throw new Error('Invalid response received from train server.');
        }
      }

      if (!res.ok && data && data.error) {
        // Continue to show backend-provided error below
      } else if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText || 'Error querying train servers'}`);
      }
    } catch (networkErr) {
      console.error('Live search network error:', networkErr);
      loadingIndicator.classList.add('hidden');
      searchSubmitBtn.disabled = false;
      searchSubmitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass text-xs"></i><span class="whitespace-nowrap">Find Trains</span>';
      if (deepSearchSubmitBtn) {
        deepSearchSubmitBtn.disabled = false;
        deepSearchSubmitBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-300 text-xs"></i><span class="whitespace-nowrap">Deep Search</span>';
      }
      state.isLoading = false;

      const msg = networkErr.message || '';
      if (networkErr.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout')) {
        showToast('Request timed out while querying Bangladesh Railway. Please try again.', 'error');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        showToast('Unable to connect to train server. Please check your internet or server status.', 'error');
      } else {
        showToast(msg || 'Network error while querying live Bangladesh Railway servers.', 'error');
      }
      return;
    }

    loadingIndicator.classList.add('hidden');
    searchSubmitBtn.disabled = false;
    searchSubmitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass text-xs"></i><span class="whitespace-nowrap">Find Trains</span>';
    if (deepSearchSubmitBtn) {
      deepSearchSubmitBtn.disabled = false;
      deepSearchSubmitBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-300 text-xs"></i><span class="whitespace-nowrap">Deep Search</span>';
    }
    state.isLoading = false;

    if (!data) return;

    // Handle Session Expiration / Authentication Failure
    if (data.session_expired || data.auth_error || data.auth_required) {
      updateAuthUI(false, null, null, null, null, false);

      if (isSilent) {
        console.warn('[Search] Silent auto-refresh hit expired Shohoz session; pausing monitor instead of auto-logout.');
        showToast('⚠️ Live Shohoz session expired. Auto-monitor paused — connect a fresh token to resume.', 'error');
        return;
      }

      showToast(data.error || '⚠️ Your Shohoz session has expired. Please refresh your credentials.', 'error');
      
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="p-6 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center space-y-3 animate-fade-in my-4">
            <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
              <i class="fa-solid fa-key"></i>
            </div>
            <div class="space-y-1">
              <h4 class="font-extrabold text-sm text-slate-900 dark:text-white">Live Shohoz Session Expired</h4>
              <p class="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                Your Bangladesh Railway session token has expired or requires renewal. Connect a fresh live token to scan real-time seats.
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button type="button" id="reconnectLiveApiBtn" class="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-xs shadow-md transition flex items-center space-x-1.5 cursor-pointer">
                <i class="fa-solid fa-bolt text-xs"></i>
                <span>Connect Live API (1-Click)</span>
              </button>
              <a href="https://eticket.railway.gov.bd" target="_blank" rel="noopener" class="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-50 transition inline-flex items-center space-x-1">
                <span>Open eticket.railway.gov.bd</span>
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
            </div>
          </div>
        `;

        const reconnectBtn = document.getElementById('reconnectLiveApiBtn');
        if (reconnectBtn) {
          reconnectBtn.addEventListener('click', () => {
            authModal.classList.remove('hidden');
            resetTabs();
            tabScriptBtn.className = 'py-2 px-3 border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold';
            scriptCopyTab.classList.remove('hidden');
          });
        }

        setTimeout(() => {
          try {
            resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) {}
        }, 100);
      }

      authModal.classList.remove('hidden');
      resetTabs();
      tabScriptBtn.className = 'py-2 px-3 border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold';
      scriptCopyTab.classList.remove('hidden');
      return;
    }

    if (data.rate_limited) {
      showToast('⏳ ' + (data.error || 'Shohoz rate-limit cooldown active. Please wait 3-5 seconds.'), 'info');
      return;
    }

    if (!data.success) {
      showToast(data.error || 'Failed to fetch live train availability.', 'error');
      return;
    }

    if (data.cooldown_notice && !isSilent) {
      showToast('ℹ️ ' + data.cooldown_notice, 'info');
    }

    // Safe Rendering Block: errors here are UI/rendering issues, not network errors
    try {
      // Populate train filter options from live trains
      if (Array.isArray(data.trains) && data.trains.length > 0) {
        populateTrainFilterOptions(data.trains);
      }

      detectSeatChanges(Array.isArray(data.trains) ? data.trains : []);
      state.lastSearchData = data;
      renderResults(data, checkAlternates, isSilent);
      updateTrackerBar(data);

      // Smooth auto-scroll down to results view
      if (!isSilent) {
        setTimeout(() => {
          try {
            const resultsTarget = document.getElementById('trackerBar') || document.getElementById('resultsContainer') || trainsGrid;
            if (resultsTarget) {
              resultsTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          } catch (scrollErr) {
            console.warn('Auto-scroll results error:', scrollErr);
          }
        }, 120);
      }
    } catch (renderErr) {
      console.error('Error rendering train results:', renderErr);
      showToast('Error displaying train results: ' + (renderErr.message || 'Render error'), 'error');
    }
  }

  function detectSeatChanges(currentTrains) {
    if (!Array.isArray(currentTrains)) return;
    let soldOutReleasedFound = false;
    let normalSeatFound = false;
    let releasedTrainInfo = null;

    const dojParam = formatShohozDoj(state.selectedDate);

    currentTrains.forEach(train => {
      if (!train) return;
      (train.seat_types || []).forEach(st => {
        if (!st) return;
        const key = `${train.train_name || 'Train'}_${st.type || 'CLASS'}`;
        const prev = state.previousSeatCounts.get(key);
        const curr = Number(st.seats_available || 0) + Number(st.counter_seats_available || 0);

        // CASE 1: Previously ALL SOLD OUT (0 seats) and now has seats (>0) -> URGENT RELEASED SEAT!
        if (prev !== undefined && prev === 0 && curr > 0) {
          soldOutReleasedFound = true;
          const chosenClass = st.type || 'S_CHAIR';
          const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);

          releasedTrainInfo = {
            trainName: train.train_name || 'Train',
            trainModel: train.train_model || '',
            className: st.display_name || st.type || 'Class',
            seats: curr,
            bookUrl: bookUrl,
            fromSoldOut: true
          };
        } 
        // CASE 2: Normal seat increase / additional availability (prev > 0 and curr > prev)
        else if (prev !== undefined && curr > prev && prev > 0) {
          normalSeatFound = true;
          const chosenClass = st.type || 'S_CHAIR';
          const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);

          if (!releasedTrainInfo) {
            releasedTrainInfo = {
              trainName: train.train_name || 'Train',
              trainModel: train.train_model || '',
              className: st.display_name || st.type || 'Class',
              seats: curr,
              bookUrl: bookUrl,
              fromSoldOut: false
            };
          }
        }

        state.previousSeatCounts.set(key, curr);
      });
    });

    // Evaluate Active Targeted Watchlist Targets
    if (state.watchlist && state.watchlist.length > 0) {
      state.watchlist.forEach(target => {
        if (!target || !target.active) return;
        const targetTrainName = (target.trainName || '').toLowerCase().trim();
        const trainMatch = currentTrains.find(t => 
          (t?.train_name && targetTrainName && t.train_name.toLowerCase().trim() === targetTrainName) ||
          (t?.train_model && target.trainModel && String(t.train_model) === String(target.trainModel))
        );
        if (!trainMatch) return;

        (trainMatch.seat_types || []).forEach(st => {
          if (target.className !== 'ANY' && st.type !== target.className) return;
          const curr = Number(st.seats_available || 0) + Number(st.counter_seats_available || 0);
          if (curr >= (target.minSeats || 1)) {
            const key = `target_notified_${target.id}_${curr}`;
            if (!state.previousSeatCounts.has(key)) {
              state.previousSeatCounts.set(key, true);

              // 🎯 Play High-Priority Watchlist Radar Alarm Sound
              playRadarTargetHitSound();

              // 🎯 Show Glowing Radar Toast
              showRadarHitToast(trainMatch.train_name, st.display_name || st.type, curr, buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, st.type));

              const alertPayload = {
                trainName: trainMatch.train_name,
                trainModel: trainMatch.train_model,
                className: st.display_name || st.type,
                seats: curr,
                fromCity: state.selectedFrom,
                toCity: state.selectedTo,
                date: dojParam,
                bookUrl: buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, st.type),
                isRadarHit: true
              };

              // 🖥️ Send High-Priority Desktop Notification
              sendDesktopNotification(
                `🎯 [RADAR HIT] ${trainMatch.train_name} Released ${curr} Seats!`,
                `Target matched: ${curr} seat(s) available in ${st.display_name || st.type} on ${trainMatch.train_name} for ${dojParam}! Click to book now.`,
                alertPayload.bookUrl
              );

              // 🔔 Send Telegram message automatically with Radar formatting
              sendTelegramAlert(alertPayload);

              // 📥 Record in Notification Center with Gold/Amber Radar badge
              addStoredNotification({
                ...alertPayload,
                title: `🎯 Radar Hit: ${trainMatch.train_name}`,
                message: `Target matched! ${trainMatch.train_name} (#${trainMatch.train_model}) currently has ${curr} seat(s) available in ${st.display_name}!`,
                type: 'RADAR_TARGET_HIT'
              });
            }
          }
        });
      });
    }

    // 🚨 CASE 1: AVAILABLE SEATS RELEASED FROM ALL SOLD OUT (Urgent High Priority Alert)
    if (soldOutReleasedFound && releasedTrainInfo) {
      // 🚨 Play Urgent Ascending Alarm Sound
      playSoldOutReleasedSound();

      // 🖥️ Send Urgent Desktop Notification
      sendDesktopNotification(
        `🚨 [RELEASED!] ${releasedTrainInfo.trainName} Has Seats!`,
        `Urgent Alert: ${releasedTrainInfo.seats} seat(s) just released on ${releasedTrainInfo.trainName} (${releasedTrainInfo.className}) for ${dojParam}! Book immediately.`,
        releasedTrainInfo.bookUrl
      );

      // 🔴 Show Urgent Glowing Banner & Fiery Toast
      showSeatReleaseBanner(releasedTrainInfo);
      showSoldOutReleasedToast(releasedTrainInfo.trainName, releasedTrainInfo.className, releasedTrainInfo.seats, releasedTrainInfo.bookUrl);

      // 📥 Store in Top Menu Notification Center with Bold Red/Amber Badge
      addStoredNotification({
        title: `🚨 RELEASED! (${releasedTrainInfo.trainName})`,
        message: `⚡ ${releasedTrainInfo.seats} seat(s) just dropped and released on ${releasedTrainInfo.trainName} (#${releasedTrainInfo.trainModel}) for ${releasedTrainInfo.className}!`,
        trainName: releasedTrainInfo.trainName,
        trainModel: releasedTrainInfo.trainModel,
        className: releasedTrainInfo.className,
        seats: releasedTrainInfo.seats,
        fromCity: state.selectedFrom,
        toCity: state.selectedTo,
        date: dojParam,
        bookUrl: releasedTrainInfo.bookUrl,
        type: 'SOLD_OUT_RELEASED'
      });
    } 
    // 🟢 CASE 2: NORMAL AVAILABLE SEAT INCREASE (Pleasant Routine Chime)
    else if (normalSeatFound && releasedTrainInfo) {
      // 🎵 Play Normal Pleasant Railway Bell Sound
      playNormalSeatReleaseSound();

      // 🖥️ Send Standard Desktop Notification
      sendDesktopNotification(
        `🚆 Seat Update: ${releasedTrainInfo.trainName}`,
        `${releasedTrainInfo.seats} seat(s) available on ${releasedTrainInfo.trainName} (${releasedTrainInfo.className}) for ${dojParam}! Click to book.`,
        releasedTrainInfo.bookUrl
      );

      // 🟢 Show Standard Banner & Toast
      showSeatReleaseBanner(releasedTrainInfo);
      showToast(`🟢 <b>${releasedTrainInfo.seats} seat(s)</b> available on <span class="bg-slate-900 text-white font-black px-1.5 py-0.5 rounded shadow-2xs">${releasedTrainInfo.trainName}</span> for <span class="bg-amber-300 text-amber-950 font-black px-1.5 py-0.5 rounded shadow-2xs">${releasedTrainInfo.className}</span>`, 'success');

      // 📥 Store in Top Menu Notification Center with Green badge
      addStoredNotification({
        title: `🟢 Seat Alert (${releasedTrainInfo.trainName})`,
        message: `${releasedTrainInfo.seats} seat(s) available on ${releasedTrainInfo.trainName} (#${releasedTrainInfo.trainModel}) for ${releasedTrainInfo.className}!`,
        trainName: releasedTrainInfo.trainName,
        trainModel: releasedTrainInfo.trainModel,
        className: releasedTrainInfo.className,
        seats: releasedTrainInfo.seats,
        fromCity: state.selectedFrom,
        toCity: state.selectedTo,
        date: dojParam,
        bookUrl: releasedTrainInfo.bookUrl,
        type: 'SEAT_RELEASED'
      });
    }
  }

  // ----------------------------------------------------
  // Rendering Live Results
  // ----------------------------------------------------
  function renderResults(data, requestedAlternates = false, isSilent = false) {
    const trains = Array.isArray(data?.trains) ? data.trains : [];

    // Filter by Train if selected
    let filteredTrains = trains;
    if (state.selectedTrain && state.selectedTrain !== 'ALL') {
      filteredTrains = filteredTrains.filter(t => 
        (t?.train_name || '').toLowerCase().trim() === state.selectedTrain.toLowerCase().trim()
      );
    }

    // Filter by Class if selected
    if (state.selectedClass && state.selectedClass !== 'ALL') {
      filteredTrains = filteredTrains.filter(t => 
        (t?.seat_types || []).some(s => (s?.type || '').toUpperCase() === state.selectedClass.toUpperCase())
      );
    }

    if (filteredTrains.length === 0) {
      updateStats([], state.selectedClass);
      trainsGrid.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-10 text-center border border-slate-200 dark:border-slate-800 space-y-3">
          <div class="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl mx-auto">
            <i class="fa-solid fa-filter-circle-xmark"></i>
          </div>
          <h4 class="font-bold text-slate-800 dark:text-white">No Live Trains Match Filters</h4>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            No live trains returned by Shohoz matched "${state.selectedFrom} &rarr; ${state.selectedTo}" for your selected filter.
          </p>
          <div class="pt-2">
            <button id="resetFiltersBtn" class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-600 text-xs font-semibold transition border border-slate-200 dark:border-slate-700">
              <i class="fa-solid fa-rotate-left mr-1"></i> Reset Filters to All
            </button>
          </div>
        </div>
      `;

      const resetBtn = document.getElementById('resetFiltersBtn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          state.selectedTrain = 'ALL';
          state.selectedClass = 'ALL';
          trainFilterSelect.value = 'ALL';
          classFilterSelect.value = 'ALL';
          renderResults(data, requestedAlternates, isSilent);
        });
      }
      return;
    }

    // Update stats ribbon dynamically according to active filter
    updateStats(filteredTrains, state.selectedClass);

    if (state.viewMode === 'grid') {
      renderGridView(filteredTrains);
      trainsGrid.classList.remove('hidden');
      trainsTableView.classList.add('hidden');
    } else {
      renderTableView(filteredTrains);
      trainsGrid.classList.add('hidden');
      trainsTableView.classList.remove('hidden');
    }

    // If Deep Search was explicitly clicked, render the Available Same-Train Stoppage & Junction Split Routes
    if (requestedAlternates) {
      if (data.alternate_routes && data.alternate_routes.length > 0) {
        renderAlternateRoutes(data.alternate_routes);
      } else if (alternateRoutesContainer) {
        alternateRoutesContainer.classList.remove('hidden');
        alternateRoutesContainer.innerHTML = `
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-center text-xs animate-fade-in shadow-sm">
            <div class="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm mx-auto">
              <i class="fa-solid fa-magnifying-glass-chart"></i>
            </div>
            <h4 class="font-extrabold text-sm text-white">No Same-Train Stoppage / Junction Seats Found</h4>
            <p class="text-[11px] text-slate-400 max-w-md mx-auto">Deep search scanned intermediate stoppage quotas on the same train and junction connections, but all connecting legs are currently sold out for this date.</p>
          </div>
        `;
      }
    } else if (!isSilent) {
      // Manual default search: keep alternate routes container hidden
      if (alternateRoutesContainer) {
        alternateRoutesContainer.classList.add('hidden');
        alternateRoutesContainer.innerHTML = '';
      }
    }
    // Note: When isSilent === true (auto-refresh from monitor ticker), do NOT touch alternateRoutesContainer at all
  }

  // ----------------------------------------------------
  // Render Smart Alternate Junction & Same-Train Split Routes
  // ----------------------------------------------------
  function renderAlternateRoutes(alternateRoutes) {
    if (!alternateRoutesContainer) return;

    if (!alternateRoutes || alternateRoutes.length === 0) {
      alternateRoutesContainer.classList.add('hidden');
      alternateRoutesContainer.innerHTML = '';
      return;
    }

    // Filter out connections where layover is invalid or Train 2 departs before Train 1
    const validRoutes = alternateRoutes.filter(alt => {
      if (alt.is_same_train) return true;
      if (typeof alt.layover_minutes === 'number') {
        return alt.layover_minutes >= 20 && alt.layover_minutes <= 240;
      }
      const t1Arr = parseTimeToMinutes(alt.leg1?.arrival_time) || parseTimeToMinutes(alt.leg1?.departure_time);
      const t2Dep = parseTimeToMinutes(alt.leg2?.departure_time);
      if (t1Arr !== null && t2Dep !== null) {
        let diff = t2Dep - t1Arr;
        if (diff < 0) diff += 1440;
        return diff >= 20 && diff <= 240;
      }
      return true;
    });

    if (validRoutes.length === 0) {
      alternateRoutesContainer.classList.add('hidden');
      alternateRoutesContainer.innerHTML = '';
      return;
    }

    const sameTrainCount = validRoutes.filter(r => r.is_same_train).length;
    const transferCount = validRoutes.filter(r => !r.is_same_train).length;

    const renderClassChips = (seatTypes) => {
      if (!seatTypes || !seatTypes.length) return '';
      const avail = seatTypes.filter(s => (Number(s.seats_available) || 0) > 0);
      if (!avail.length) return '';
      return `<div class="flex flex-wrap gap-1 pt-1">${avail.map(s => `<span class="px-1.5 py-0.5 rounded text-[9px] bg-slate-900/90 text-emerald-300 font-mono font-bold border border-slate-700/80">${escapeHtml(s.type)}: ${s.seats_available}</span>`).join('')}</div>`;
    };

    alternateRoutesContainer.classList.remove('hidden');
    alternateRoutesContainer.innerHTML = `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-indigo-950/40 border-2 border-emerald-500/40 space-y-3 shadow-md animate-fade-in">
        <div class="flex items-center justify-between flex-wrap gap-2.5">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
              <i class="fa-solid fa-route"></i>
            </div>
            <div>
              <h4 class="font-black text-sm text-white flex items-center space-x-2">
                <span>⚡ Smart Alternate Stoppage & Junction Split Routes</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500 text-slate-950 font-black">${validRoutes.length} Found</span>
              </h4>
              <p class="text-[11px] text-emerald-200/80">Direct end-to-end seats are sold out. Book via <b>Same-Train Stoppage Quota</b> or take the <b>Longest Available Leg</b> and connect smoothly!</p>
            </div>
          </div>

          <!-- Interactive Filter Tabs -->
          <div class="flex items-center space-x-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-[11px]" id="alt-routes-filter-tabs">
            <button type="button" data-alt-filter="all" class="alt-filter-tab px-2.5 py-1 rounded-lg font-bold transition-all bg-emerald-500 text-slate-950 shadow-sm">
              All (${validRoutes.length})
            </button>
            ${sameTrainCount > 0 ? `
              <button type="button" data-alt-filter="same" class="alt-filter-tab px-2.5 py-1 rounded-lg font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-800">
                🟢 Same-Train (${sameTrainCount})
              </button>
            ` : ''}
            ${transferCount > 0 ? `
              <button type="button" data-alt-filter="transfer" class="alt-filter-tab px-2.5 py-1 rounded-lg font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-800">
                🔵 Junction (${transferCount})
              </button>
            ` : ''}
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-0.5" id="alt-routes-grid">
          ${validRoutes.map((alt, idx) => {
            const leg1Book = buildShohozBookingUrl(alt.leg1.from, alt.leg1.to, state.selectedDate, 'ALL');
            const leg2Book = buildShohozBookingUrl(alt.leg2.from, alt.leg2.to, state.selectedDate, 'ALL');
            const isSameTrain = !!alt.is_same_train;
            const isBestMatch = !!alt.is_best_match;
            const layoverStr = alt.layover_text || 'Transfer';
            const minSeats = alt.guaranteed_seats || Math.min(alt.leg1?.seats || 0, alt.leg2?.seats || 0);

            // Layover badge rendering
            let layoverBadge = '';
            if (isSameTrain) {
              layoverBadge = `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold"><i class="fa-solid fa-couch text-[9px]"></i><span>0m • Stay Onboard</span></span>`;
            } else if (alt.layover_quality === 'OPTIMAL') {
              layoverBadge = `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold"><i class="fa-solid fa-clock-check text-[9px]"></i><span>${layoverStr}</span></span>`;
            } else if (alt.layover_quality === 'QUICK') {
              layoverBadge = `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold"><i class="fa-solid fa-bolt text-[9px]"></i><span>${layoverStr}</span></span>`;
            } else {
              layoverBadge = `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold"><i class="fa-solid fa-mug-hot text-[9px]"></i><span>${layoverStr}</span></span>`;
            }

            const commonClassBadge = (alt.common_classes && alt.common_classes.length > 0)
              ? `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[10px] font-bold"><i class="fa-solid fa-chair text-[9px]"></i><span>Shared: ${alt.common_classes.join(', ')}</span></span>`
              : '';

            const fareBadge = alt.combined_fare
              ? `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold font-mono"><span>Est. ৳${alt.combined_fare}</span></span>`
              : '';

            const guaranteedBadge = `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-mono font-bold"><span>🟢 Min ${minSeats} Seats</span></span>`;

            const cardBorder = isBestMatch
              ? 'border-2 border-amber-400/90 shadow-lg shadow-amber-500/10 ring-1 ring-amber-400/40'
              : (isSameTrain ? 'border-2 border-emerald-500/60 shadow-md' : 'border-2 border-indigo-500/50 shadow-sm');

            return `
              <div class="alt-route-card p-3.5 rounded-2xl bg-slate-900/95 ${cardBorder} space-y-2.5 text-xs relative overflow-hidden transition-all" data-alt-category="${isSameTrain ? 'same' : 'transfer'}">
                
                <!-- Option Header -->
                <div class="flex items-center justify-between border-b-2 border-slate-800 pb-2 flex-wrap gap-1.5">
                  <div class="flex items-center space-x-1.5 min-w-0">
                    ${isBestMatch ? `
                      <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-slate-950 uppercase tracking-wider shadow-sm shrink-0">
                        <i class="fa-solid fa-crown text-[8px]"></i>
                        <span>Best Match</span>
                      </span>
                    ` : ''}
                    <span class="font-extrabold text-white text-xs sm:text-sm truncate">
                      ${isSameTrain ? alt.train_name : `Option ${idx + 1}: ${alt.leg1.train_name} ➔ ${alt.leg2.train_name}`}
                    </span>
                    ${isSameTrain ? `<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono font-bold border border-slate-700">#${alt.train_model}</span>` : ''}
                  </div>
                  
                  <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[10px] font-black shrink-0 ${isSameTrain ? 'bg-emerald-500/20 text-emerald-300 border-2 border-emerald-500/50' : 'bg-indigo-500/20 text-indigo-300 border-2 border-indigo-500/50'}">
                    <i class="fa-solid ${isSameTrain ? 'fa-train-circle-check text-emerald-400' : 'fa-train-subway text-indigo-400'} text-[9px]"></i>
                    <span>${isSameTrain ? `SAME TRAIN (Via ${alt.via_hub})` : `🚀 Junction via ${alt.via_hub}`}</span>
                  </span>
                </div>

                <!-- Match Metrics Badges -->
                <div class="flex items-center flex-wrap gap-1.5">
                  ${layoverBadge}
                  ${guaranteedBadge}
                  ${commonClassBadge}
                  ${fareBadge}
                </div>

                ${isSameTrain ? `
                  <div class="text-[11px] text-emerald-300/95 bg-emerald-950/60 px-2.5 py-1.5 rounded-xl border-2 border-emerald-800/40 flex items-center space-x-1.5 font-medium">
                    <i class="fa-solid fa-circle-check text-xs text-emerald-400 shrink-0"></i>
                    <span><b>Ghost Seat / Same Train Quota:</b> No train change needed! Board <b>${alt.train_name}</b> and remain onboard for the entire journey.</span>
                  </div>
                ` : `
                  <div class="text-[11px] text-indigo-200 bg-indigo-950/60 px-2.5 py-1.5 rounded-xl border-2 border-indigo-800/40 flex items-center space-x-1.5 font-medium">
                    <i class="fa-solid fa-shuffle text-xs text-indigo-400 shrink-0"></i>
                    <span>Ride <b>${alt.leg1.train_name}</b> to ${alt.via_hub}, then switch to <b>${alt.leg2.train_name}</b> (⏱️ ${layoverStr} wait).</span>
                  </div>
                `}
                
                <!-- Leg 1 Breakdown (Longest First Leg) -->
                <div class="space-y-1.5 bg-slate-800/60 p-2.5 rounded-xl border-2 border-slate-700/80">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-extrabold text-slate-100 flex items-center space-x-1">
                      <span class="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] inline-flex items-center justify-center font-bold">1</span>
                      <span>${alt.leg1.from} ➔ ${alt.leg1.to}</span>
                    </span>
                    <span class="text-[10px] font-black text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-700/60 font-mono">🟢 ${alt.leg1.seats} Seats</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                    <span>${alt.leg1.train_name} (${alt.leg1.departure_time || ''} - ${alt.leg1.arrival_time || ''})</span>
                    <a href="${leg1Book}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 font-extrabold flex items-center space-x-1">
                      <span>Book Leg 1</span>
                      <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                    </a>
                  </div>
                  ${renderClassChips(alt.leg1.seat_types)}
                </div>

                <!-- Transfer Connector Bar (If switching trains) -->
                ${!isSameTrain ? `
                  <div class="flex items-center justify-center space-x-2 py-0.5 text-[10px] font-bold text-amber-300">
                    <i class="fa-solid fa-arrow-down text-[9px]"></i>
                    <span>Transfer at ${alt.via_hub} (${layoverStr})</span>
                    <i class="fa-solid fa-arrow-down text-[9px]"></i>
                  </div>
                ` : `
                  <div class="flex items-center justify-center space-x-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    <i class="fa-solid fa-couch text-[9px]"></i>
                    <span>Intermediate Stoppage at ${alt.via_hub} (Stay seated)</span>
                    <i class="fa-solid fa-couch text-[9px]"></i>
                  </div>
                `}

                <!-- Leg 2 Breakdown (Next Train Connection) -->
                <div class="space-y-1.5 bg-slate-800/60 p-2.5 rounded-xl border-2 border-slate-700/80">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-extrabold text-slate-100 flex items-center space-x-1">
                      <span class="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] inline-flex items-center justify-center font-bold">2</span>
                      <span>${alt.leg2.from} ➔ ${alt.leg2.to}</span>
                    </span>
                    <span class="text-[10px] font-black text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-700/60 font-mono">🟢 ${alt.leg2.seats} Seats</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                    <span>${alt.leg2.train_name} (${alt.leg2.departure_time || ''} - ${alt.leg2.arrival_time || ''})</span>
                    <a href="${leg2Book}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 font-extrabold flex items-center space-x-1">
                      <span>Book Leg 2</span>
                      <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                    </a>
                  </div>
                  ${renderClassChips(alt.leg2.seat_types)}
                </div>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Attach Interactive Filter Tab Event Handlers
    const filterTabsContainer = alternateRoutesContainer.querySelector('#alt-routes-filter-tabs');
    if (filterTabsContainer) {
      filterTabsContainer.querySelectorAll('.alt-filter-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const filter = tabBtn.getAttribute('data-alt-filter');
          
          // Update active button styles
          filterTabsContainer.querySelectorAll('.alt-filter-tab').forEach(b => {
            b.className = 'alt-filter-tab px-2.5 py-1 rounded-lg font-bold transition-all text-slate-300 hover:text-white hover:bg-slate-800';
          });
          tabBtn.className = 'alt-filter-tab px-2.5 py-1 rounded-lg font-bold transition-all bg-emerald-500 text-slate-950 shadow-sm';

          // Show/Hide matching cards
          const cards = alternateRoutesContainer.querySelectorAll('.alt-route-card');
          cards.forEach(card => {
            const cat = card.getAttribute('data-alt-category');
            if (filter === 'all' || cat === filter) {
              card.classList.remove('hidden');
            } else {
              card.classList.add('hidden');
            }
          });
        });
      });
    }
  }

  // ----------------------------------------------------
  // Update Top Stats Ribbon (Dynamic per Selected Train & Class Filters)
  // ----------------------------------------------------
  function updateStats(trains, filteredClass = 'ALL') {
    statsRibbon.classList.remove('hidden');
    let totalSeats = 0;

    trains.forEach(t => {
      (t.seat_types || []).forEach(s => {
        if (filteredClass && filteredClass !== 'ALL' && s.type.toUpperCase() !== filteredClass.toUpperCase()) {
          return;
        }
        const onlineCount = Number(s.seats_available || 0);
        const counterCount = Number(s.counter_seats_available || 0);
        totalSeats += (onlineCount + counterCount);
      });
    });

    statTotalTrains.textContent = trains.length;
    statCombinedSeats.textContent = totalSeats;
  }

  function updateTrackerBar(data) {
    trackerBar.classList.remove('hidden');
    activeFromBadge.textContent = state.selectedFrom;
    activeToBadge.textContent = state.selectedTo;
    activeDateBadge.textContent = formatShohozDoj(state.selectedDate);
    lastUpdatedTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ----------------------------------------------------
  // ----------------------------------------------------
  // 📱 Mobile App Ticket Card Grid View Renderer
  // ----------------------------------------------------
  function renderGridView(trains) {
    const dojParam = formatShohozDoj(state.selectedDate);

    trainsGrid.innerHTML = trains.map(train => {
      const isBn = window.i18n && window.i18n.getLang() === 'bn';
      const grandTotal = (train.seat_types || []).reduce((sum, s) => {
        return sum + Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
      }, 0);

      const hasAnySeats = grandTotal > 0;
      const availClasses = (train.seat_types || []).filter(s => (Number(s.seats_available || 0) + Number(s.counter_seats_available || 0)) > 0);
      const chosenClass = state.selectedClass !== 'ALL' ? state.selectedClass : (availClasses.length > 0 ? availClasses[0].type : (train.seat_types?.[0]?.type || 'S_CHAIR'));
      const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);

      const depStationDisplay = window.i18n ? window.i18n.getStationName(train.departure_station) : train.departure_station;
      const arrStationDisplay = window.i18n ? window.i18n.getStationName(train.arrival_station) : train.arrival_station;
      const depTimeDisplay = isBn ? window.i18n.toBnNum(train.departure_time) : train.departure_time;
      const arrTimeDisplay = isBn ? window.i18n.toBnNum(train.arrival_time) : train.arrival_time;
      const offDayDisplay = isBn ? (train.off_day === 'None' || !train.off_day ? 'নেই' : train.off_day) : (train.off_day || 'None');
      const offDayLabel = isBn ? 'ছুটি' : 'Off';
      const availStatusText = hasAnySeats ? (isBn ? `${window.i18n.toBnNum(grandTotal)} সিট উপলব্ধ` : `${grandTotal} Available`) : (isBn ? 'সব বুকড' : 'SOLD OUT');
      const bookBtnText = isBn ? 'সহজে টিকিট কাটুন' : 'Book on Shohoz';
      const routeBtnText = isBn ? 'রুট' : 'Route';
      const matrixBtnText = isBn ? 'স্টপেজ' : 'Stops';
      const alertBtnText = isBn ? 'অ্যালার্ট' : 'Alert';

      return `
        <div class="app-ticket-card bg-white dark:bg-slate-900 rounded-xl p-3.5 sm:p-4 border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition space-y-3">
          
          <!-- TOP HEADER: Train Identity & Real-Time Status Pill -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center space-x-2.5 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                <i class="fa-solid fa-train"></i>
              </div>
              <div class="min-w-0">
                <div class="flex items-center space-x-2">
                  <h3 class="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight truncate">${train.train_name}</h3>
                  <span class="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">#${train.train_model}</span>
                </div>
                <p class="text-[11px] text-slate-500 dark:text-slate-400">
                  ${offDayLabel}: <span class="font-medium text-slate-700 dark:text-slate-300">${offDayDisplay}</span>
                </p>
              </div>
            </div>

            <!-- Total Seats Badge Pill (Aero Rail clean status) -->
            <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 ${
              hasAnySeats 
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }">
              <span class="w-1.5 h-1.5 rounded-full ${hasAnySeats ? 'bg-emerald-600' : 'bg-slate-400'}"></span>
              <span class="tnum">${availStatusText}</span>
            </span>
          </div>

          <!-- ROUTE JOURNEY RIBBON (Flight/Travel Utility Style) -->
          <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-850 px-3 sm:px-4 py-2.5 rounded-lg border border-slate-100 dark:border-slate-800 text-xs">
            <div class="text-left min-w-[70px]">
              <div class="font-bold text-slate-900 dark:text-white text-sm sm:text-base tnum leading-none">${depTimeDisplay}</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 truncate max-w-[120px]">${depStationDisplay}</div>
            </div>

            <!-- Duration & Center Connector -->
            <div class="flex flex-col items-center px-2 flex-1 max-w-[150px]">
              <span class="text-[10px] text-slate-400 font-medium tnum">${train.travel_time || 'Express'}</span>
              <div class="w-full flex items-center justify-center my-1 relative">
                <div class="w-full h-px bg-slate-300 dark:bg-slate-700"></div>
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-600 absolute left-0"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-600 absolute right-0"></span>
              </div>
              <span class="text-[9px] text-emerald-700 dark:text-emerald-400 font-semibold uppercase tracking-wider">${isBn ? 'সরাসরি' : 'Direct'}</span>
            </div>

            <div class="text-right min-w-[70px]">
              <div class="font-bold text-slate-900 dark:text-white text-sm sm:text-base tnum leading-none">${arrTimeDisplay}</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 truncate max-w-[120px]">${arrStationDisplay}</div>
            </div>
          </div>

          <!-- SEAT CLASSES GRID (Aero Rail Tabular Inventory Chips) -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            ${(train.seat_types || []).map(st => renderSeatPill(st, state.selectedFrom, state.selectedTo, state.selectedDate, train)).join('')}
          </div>

          <!-- ACTION BAR: Secondary Controls + Flight Booking CTA -->
          <div class="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            
            <!-- Quick Tools (Route, Stops Matrix, 24/7 Radar Watch) -->
            <div class="flex items-center space-x-1.5 justify-start flex-wrap gap-y-1.5">
              <button type="button" class="view-route-btn inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="View Train Route & Schedule">
                <i class="fa-solid fa-route text-slate-400 text-xs"></i>
                <span>${routeBtnText}</span>
              </button>

              <button type="button" class="view-station-matrix-btn inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="View Single-Day All-Station Blank Seat Matrix">
                <i class="fa-solid fa-table-cells text-slate-400 text-xs"></i>
                <span>${matrixBtnText}</span>
              </button>

              <button type="button" class="set-watch-btn inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50/60 dark:bg-amber-950/40 hover:bg-amber-100/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 transition cursor-pointer"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="Set 24/7 seat drop alert">
                <i class="fa-regular fa-bell text-amber-500 text-xs"></i>
                <span>${alertBtnText}</span>
              </button>
            </div>

            <!-- Primary Airline Utility Booking Button -->
            <a href="${bookUrl}" target="_blank" rel="noopener" 
              class="inline-flex items-center justify-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                hasAnySeats 
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs cursor-pointer' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-800 cursor-not-allowed opacity-60'
              }">
              <i class="fa-solid fa-ticket text-xs"></i>
              <span>${bookBtnText}</span>
              <i class="fa-solid fa-arrow-up-right-from-square text-[9px] ml-0.5 opacity-80"></i>
            </a>

          </div>

        </div>
      `;
    }).join('');
  }

  // ----------------------------------------------------
  // 📱 Aero Rail Seat Class Tile Renderer
  // ----------------------------------------------------
  function renderSeatPill(seat, fromCity, toCity, journeyDate, train = {}) {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const onlineCount = Number(seat.seats_available || 0);
    const counterCount = Number(seat.counter_seats_available || 0);
    const totalSeatCount = onlineCount + counterCount;
    const isAvail = totalSeatCount > 0;
    
    const baseFare = Number(seat.fare || 0);
    const vat = Number(seat.vat || 0);
    const totalFare = Number(seat.total_fare !== undefined ? seat.total_fare : (baseFare + vat));

    const displayName = window.i18n ? window.i18n.getSeatClassName(seat.type || seat.display_name) : (seat.type || seat.display_name || '').toUpperCase();
    const seatsLabel = isBn ? `${window.i18n.toBnNum(totalSeatCount)} সিট` : `${totalSeatCount} Seats`;
    const soldOutLabel = isBn ? 'বুকড / শেষ' : 'Sold Out';
    const fareDisplay = isBn ? `৳${window.i18n.toBnNum(totalFare)}` : `৳${totalFare}`;

    const tModel = train.train_model || '';
    const tName = train.train_name || '';
    const tDepartureTime = train.departure_time || '';
    const tTripId = seat.trip_id || train.trip_id || '';
    const tTripRouteId = seat.trip_route_id || train.trip_route_id || '';
    const seatClassType = seat.type || seat.display_name || '';

    if (isAvail) {
      return `
        <button type="button"
          class="view-seat-layout-btn app-seat-tile relative block w-full text-left p-2.5 sm:p-3 rounded-lg border-2 border-emerald-500/80 dark:border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 hover:border-emerald-600 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/50 transition-all shadow-xs hover:shadow-sm group cursor-pointer"
          data-train-model="${tModel}"
          data-train-name="${tName}"
          data-departure-time="${tDepartureTime}"
          data-trip-id="${tTripId}"
          data-trip-route-id="${tTripRouteId}"
          data-seat-class="${seatClassType}"
          data-available-seats="${totalSeatCount}"
          data-online-seats="${onlineCount}"
          data-counter-seats="${counterCount}"
          data-fare="${totalFare}"
          data-from-city="${fromCity || ''}"
          data-to-city="${toCity || ''}"
          data-journey-date="${journeyDate || ''}"
          title="${displayName} (${totalSeatCount} ${isBn ? 'সিট খালি' : 'seats available'} - ${fareDisplay}) - ${isBn ? 'বগির লেআউট দেখতে ক্লিক করুন' : 'Click to view coach layout'}">
          
          <div class="flex items-center justify-between gap-1.5 mb-1.5">
            <span class="text-[11px] font-bold uppercase tracking-tight text-slate-900 dark:text-white group-hover:text-emerald-800 dark:group-hover:text-emerald-300 transition truncate">${displayName}</span>
            <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-600 dark:bg-emerald-500 text-white font-mono text-[11px] font-bold shadow-2xs leading-none shrink-0">${fareDisplay}</span>
          </div>

          <div class="flex items-baseline justify-between mt-1 pt-1 border-t border-emerald-200/80 dark:border-emerald-800/60">
            <span class="text-sm sm:text-base font-extrabold text-emerald-800 dark:text-emerald-300 tnum leading-tight">${seatsLabel}</span>
            <span class="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
              <i class="fa-solid fa-couch text-[9px]"></i>
              <span>${isBn ? 'সিট দেখুন' : 'View Seats'}</span>
            </span>
          </div>
        </button>
      `;
    } else {
      return `
        <button type="button"
          class="view-seat-layout-btn app-seat-tile block w-full text-left p-2.5 sm:p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/40 text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 transition cursor-pointer select-none group"
          data-train-model="${tModel}"
          data-train-name="${tName}"
          data-departure-time="${tDepartureTime}"
          data-trip-id="${tTripId}"
          data-trip-route-id="${tTripRouteId}"
          data-seat-class="${seatClassType}"
          data-available-seats="0"
          data-online-seats="0"
          data-counter-seats="0"
          data-fare="${totalFare}"
          data-from-city="${fromCity || ''}"
          data-to-city="${toCity || ''}"
          data-journey-date="${journeyDate || ''}"
          title="${displayName} (${soldOutLabel}) - ${isBn ? 'বগির লেআউট দেখুন' : 'View coach layout'}">
          
          <div class="flex items-center justify-between gap-1 mb-1.5">
            <span class="text-[11px] font-bold uppercase tracking-tight text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 truncate transition">${displayName}</span>
            <span class="font-mono text-[10px] text-slate-400">${fareDisplay}</span>
          </div>

          <div class="flex items-baseline justify-between mt-1 pt-1 border-t border-slate-200/50 dark:border-slate-800/50">
            <span class="text-xs font-medium text-slate-400">${soldOutLabel}</span>
            <span class="inline-flex items-center gap-1 text-[9px] text-slate-400 font-normal">
              <i class="fa-solid fa-couch text-[8px]"></i>
              <span>${isBn ? 'লেআউট' : 'Layout'}</span>
            </span>
          </div>
        </button>
      `;
    }
  }

  // ----------------------------------------------------
  // 📱 Dual-Mode Table View Renderer:
  // 1. Mobile Phone View (< 768px): Sleek List Tiles
  // 2. Desktop View (>= 768px): Spreadsheet Grid
  // ----------------------------------------------------
  function renderTableView(trains) {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const mobileContainer = document.getElementById('mobileTableList');

    // 1. Render Mobile List Tiles (< 768px)
    if (mobileContainer) {
      mobileContainer.innerHTML = trains.map(train => {
        const availClasses = (train.seat_types || []).filter(s => {
          const totalCount = Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
          return totalCount > 0;
        });

        const grandTotal = (train.seat_types || []).reduce((sum, s) => {
          return sum + Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
        }, 0);

        const hasAnySeats = grandTotal > 0;
        const chosenClass = availClasses.length > 0 ? availClasses[0].type : (state.selectedClass !== 'ALL' ? state.selectedClass : (train.seat_types?.[0]?.type || 'S_CHAIR'));
        const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);
        const depTime = isBn ? window.i18n.toBnNum(train.departure_time) : train.departure_time;
        const arrTime = isBn ? window.i18n.toBnNum(train.arrival_time) : train.arrival_time;

        return `
          <div class="mobile-table-card bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
            <!-- Row 1: Train, Model & Times -->
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="flex items-center space-x-1.5">
                  <h4 class="font-bold text-sm text-slate-900 dark:text-white">${train.train_name}</h4>
                  <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono font-bold border border-slate-200 dark:border-slate-700">#${train.train_model}</span>
                </div>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">${depTime} &rarr; ${arrTime} &bull; ${train.travel_time || 'Express'}</p>
              </div>

              <!-- Total Seats Status -->
              <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-xs font-semibold shrink-0 ${
                hasAnySeats 
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }">
                <span class="w-1.5 h-1.5 rounded-full ${hasAnySeats ? 'bg-emerald-600' : 'bg-slate-400'}"></span>
                <span class="tnum">${hasAnySeats ? (isBn ? `${window.i18n.toBnNum(grandTotal)} সিট` : `${grandTotal} Seats`) : (isBn ? 'শেষ' : 'Sold Out')}</span>
              </span>
            </div>

            <!-- Row 2: Horizontal Class Chips Scroll -->
            <div class="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-0.5">
              ${availClasses.length > 0 ? availClasses.map(s => {
                const totalCount = Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
                const fare = Number(s.total_fare !== undefined ? s.total_fare : ((Number(s.fare || 0)) + (Number(s.vat || 0))));
                const classTitle = window.i18n ? window.i18n.getSeatClassName(s.type || s.display_name) : (s.type || s.display_name || '').toUpperCase();
                const countDisplay = isBn ? window.i18n.toBnNum(totalCount) : totalCount;
                const fareDisplay = isBn ? `৳${window.i18n.toBnNum(fare)}` : `৳${fare}`;

                return `
                  <button type="button" class="view-seat-layout-btn inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-xs shrink-0 shadow-2xs cursor-pointer transition"
                    data-train-model="${train.train_model || ''}"
                    data-train-name="${train.train_name || ''}"
                    data-departure-time="${train.departure_time || ''}"
                    data-trip-id="${s.trip_id || train.trip_id || ''}"
                    data-trip-route-id="${s.trip_route_id || train.trip_route_id || ''}"
                    data-seat-class="${s.type || ''}"
                    data-available-seats="${totalCount}"
                    data-online-seats="${s.seats_available || 0}"
                    data-counter-seats="${s.counter_seats_available || 0}"
                    data-fare="${fare}"
                    data-from-city="${state.selectedFrom || ''}"
                    data-to-city="${state.selectedTo || ''}"
                    data-journey-date="${state.selectedDate || ''}"
                    title="${classTitle} (${countDisplay} ${isBn ? 'সিট' : 'seats'}) - ${isBn ? 'বগির লেআউট দেখুন' : 'Click to view coach'}">
                    <span class="font-bold text-slate-900 dark:text-white text-[11px]">${classTitle}:</span>
                    <span class="font-extrabold text-emerald-800 dark:text-emerald-300 tnum text-xs">${countDisplay}</span>
                    <span class="px-1.5 py-0.2 rounded bg-emerald-600 dark:bg-emerald-500 text-white font-mono text-[10px] font-bold shadow-2xs">${fareDisplay}</span>
                    <i class="fa-solid fa-couch text-[9px] text-emerald-600 dark:text-emerald-400 ml-0.5"></i>
                  </button>
                `;
              }).join('') : `
                <span class="text-xs text-rose-500 font-semibold py-0.5">${isBn ? 'সকল শ্রেণির সিট শেষ' : 'All classes sold out'}</span>
              `}
            </div>

            <!-- Row 3: Action Buttons Strip -->
            <div class="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 gap-2">
              <div class="flex items-center space-x-1">
                <button type="button" class="view-route-btn p-1.5 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition"
                  data-train-model="${train.train_model || ''}"
                  data-train-name="${train.train_name || ''}"
                  title="Route">
                  <i class="fa-solid fa-route text-slate-400 text-xs"></i>
                </button>
                <button type="button" class="view-station-matrix-btn p-1.5 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition"
                  data-train-model="${train.train_model || ''}"
                  data-train-name="${train.train_name || ''}"
                  title="Stops Matrix">
                  <i class="fa-solid fa-table-cells text-slate-400 text-xs"></i>
                </button>
                <button type="button" class="set-watch-btn p-1.5 rounded-md bg-amber-50/60 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 border border-amber-200 dark:border-amber-800/60 text-xs font-semibold transition"
                  data-train-model="${train.train_model || ''}"
                  data-train-name="${train.train_name || ''}"
                  title="Alert Watch">
                  <i class="fa-regular fa-bell text-amber-500 text-xs"></i>
                </button>
              </div>

              <a href="${bookUrl}" target="_blank" rel="noopener" 
                class="px-3 py-1.5 rounded-md ${
                  hasAnySeats 
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white font-semibold shadow-xs' 
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                } text-xs transition inline-flex items-center space-x-1.5">
                <span>${isBn ? 'টিকিট কাটুন' : 'Book'}</span>
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px] opacity-80"></i>
              </a>
            </div>
          </div>
        `;
      }).join('');
    }

    // 2. Render Wide Desktop Spreadsheet Table (>= 768px)
    tableBody.innerHTML = trains.map(train => {
      const availClasses = (train.seat_types || []).filter(s => {
        const totalCount = Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
        return totalCount > 0;
      });

      const grandTotal = (train.seat_types || []).reduce((sum, s) => {
        return sum + Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
      }, 0);

      const hasAnySeats = grandTotal > 0;
      const chosenClass = availClasses.length > 0 ? availClasses[0].type : (state.selectedClass !== 'ALL' ? state.selectedClass : (train.seat_types?.[0]?.type || 'S_CHAIR'));
      const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);

      let classesHtml = '';
      if (availClasses.length > 0) {
        classesHtml = `
          <div class="flex flex-wrap gap-1.5 items-center py-0.5">
            ${availClasses.map(s => {
              const onlineCount = Number(s.seats_available || 0);
              const counterCount = Number(s.counter_seats_available || 0);
              const totalCount = onlineCount + counterCount;
              const baseFare = Number(s.fare || 0);
              const vat = Number(s.vat || 0);
              const totalFare = Number(s.total_fare !== undefined ? s.total_fare : (baseFare + vat));
              const classTitle = window.i18n ? window.i18n.getSeatClassName(s.type || s.display_name) : (s.type || s.display_name || '').toUpperCase();
              const countDisplay = isBn ? window.i18n.toBnNum(totalCount) : totalCount;
              const fareDisplay = isBn ? `৳${window.i18n.toBnNum(totalFare)}` : `৳${totalFare}`;

              return `
                <button type="button" class="view-seat-layout-btn inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-700/80 text-xs shadow-2xs whitespace-nowrap cursor-pointer transition group"
                  data-train-model="${train.train_model || ''}"
                  data-train-name="${train.train_name || ''}"
                  data-departure-time="${train.departure_time || ''}"
                  data-trip-id="${s.trip_id || train.trip_id || ''}"
                  data-trip-route-id="${s.trip_route_id || train.trip_route_id || ''}"
                  data-seat-class="${s.type || ''}"
                  data-available-seats="${totalCount}"
                  data-online-seats="${onlineCount}"
                  data-counter-seats="${counterCount}"
                  data-fare="${totalFare}"
                  data-from-city="${state.selectedFrom || ''}"
                  data-to-city="${state.selectedTo || ''}"
                  data-journey-date="${state.selectedDate || ''}"
                  title="${classTitle} (${countDisplay} ${isBn ? 'সিট' : 'seats'}) - ${isBn ? 'বগির লেআউট দেখুন' : 'Click to view coach layout'}">
                  <span class="font-bold text-slate-900 dark:text-white text-[11px] group-hover:text-emerald-700 transition">${classTitle}:</span>
                  <span class="font-extrabold text-emerald-800 dark:text-emerald-300 tnum text-xs">${countDisplay}</span>
                  <span class="px-1.5 py-0.2 rounded bg-emerald-600 dark:bg-emerald-500 text-white font-mono text-[10px] font-bold shadow-2xs">${fareDisplay}</span>
                  <i class="fa-solid fa-couch text-[9px] text-emerald-600 dark:text-emerald-400 ml-0.5"></i>
                </button>
              `;
            }).join('')}
          </div>
        `;
      } else {
        classesHtml = `
          <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-xs font-semibold">
            <i class="fa-solid fa-circle-xmark mr-1 text-rose-500 text-[10px]"></i> ${isBn ? 'সব বুকড (০)' : 'All Sold Out (0)'}
          </span>
        `;
      }

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
          <td class="px-3 py-2.5 align-middle sticky left-0 bg-white dark:bg-slate-900 z-10 sticky-column-shadow border-r border-slate-200/80 dark:border-slate-800">
            <div class="font-bold text-slate-900 dark:text-white whitespace-nowrap text-xs sm:text-sm">${train.train_name}</div>
            <div class="text-[10px] sm:text-[11px] text-slate-400 whitespace-nowrap">#${train.train_model} &bull; ${isBn ? 'ছুটি' : 'Off'}: ${train.off_day || 'None'}</div>
          </td>
          <td class="px-3 py-2.5 align-middle whitespace-nowrap">
            <div class="font-extrabold text-slate-900 dark:text-slate-100">${isBn ? window.i18n.toBnNum(train.departure_time) : train.departure_time}</div>
            <div class="text-[11px] text-slate-400 truncate max-w-[110px]">${window.i18n ? window.i18n.getStationName(train.departure_station) : train.departure_station}</div>
          </td>
          <td class="px-3 py-2.5 align-middle whitespace-nowrap">
            <div class="font-extrabold text-slate-900 dark:text-slate-100">${isBn ? window.i18n.toBnNum(train.arrival_time) : train.arrival_time}</div>
            <div class="text-[11px] text-slate-400 truncate max-w-[110px]">${window.i18n ? window.i18n.getStationName(train.arrival_station) : train.arrival_station}</div>
          </td>
          <td class="px-3 py-2.5 align-middle">
            ${classesHtml}
          </td>
          <td class="px-3 py-2.5 align-middle text-center whitespace-nowrap">
            ${hasAnySeats 
              ? `<span class="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-extrabold text-xs">🟢 ${isBn ? window.i18n.toBnNum(grandTotal) : grandTotal}</span>` 
              : `<span class="px-2 py-0.5 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold text-xs">🔴 0</span>`
            }
          </td>
          <td class="px-3 py-2.5 align-middle text-center whitespace-nowrap">
            <div class="inline-flex items-center space-x-1.5">

              <button type="button" class="set-watch-btn px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 text-amber-700 dark:text-amber-300 text-xs font-semibold border border-amber-200 dark:border-amber-700/60 transition"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="Watch this train for seat releases">
                <i class="fa-solid fa-crosshairs text-[10px]"></i>
              </button>

              <button type="button" class="view-station-matrix-btn px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-xs font-semibold border border-emerald-200 dark:border-emerald-700/60 transition"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="View Single-Day All-Station Blank Seat Matrix">
                <i class="fa-solid fa-table-cells text-[10px]"></i>
              </button>

              <button type="button" class="view-route-btn px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-100 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="View Route & Stoppages">
                <i class="fa-solid fa-route text-emerald-600 text-xs"></i>
              </button>

              <a href="${bookUrl}" target="_blank" rel="noopener" 
                class="px-2.5 py-1 rounded-lg ${hasAnySeats ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold shadow-xs' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'} text-xs transition inline-flex items-center space-x-1">
                <span>${isBn ? 'বুক' : 'Book'}</span>
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ----------------------------------------------------
  // Live Train Route & Schedule Modal (from eticket.railway.gov.bd/train-information)
  // ----------------------------------------------------
  const routeModal = document.getElementById('routeModal');
  const routeModalCloseBtn = document.getElementById('routeModalCloseBtn');
  const routeModalTrainName = document.getElementById('routeModalTrainName');
  const routeModalTrainModel = document.getElementById('routeModalTrainModel');
  const routeModalSubtitle = document.getElementById('routeModalSubtitle');
  const routeTrainSearchInput = document.getElementById('routeTrainSearchInput');
  const clearRouteSearchBtn = document.getElementById('clearRouteSearchBtn');
  const routeSearchDropdown = document.getElementById('routeSearchDropdown');
  const routeLookupSubmitBtn = document.getElementById('routeLookupSubmitBtn');
  const routeTotalDuration = document.getElementById('routeTotalDuration');
  const routeRunningDays = document.getElementById('routeRunningDays');
  const routeTimelineContainer = document.getElementById('routeTimelineContainer');
  const openRouteExplorerBtn = document.getElementById('openRouteExplorerBtn');

  if (routeModalCloseBtn) {
    routeModalCloseBtn.addEventListener('click', () => routeModal.classList.add('hidden'));
  }
  if (routeModal) {
    routeModal.addEventListener('click', (e) => {
      if (e.target === routeModal) routeModal.classList.add('hidden');
    });
  }
  if (openRouteExplorerBtn) {
    openRouteExplorerBtn.addEventListener('click', () => {
      const initialModel = state.lastSearchData?.trains?.[0]?.train_model || '702';
      const initialName = state.lastSearchData?.trains?.[0]?.train_name || 'Suborno Express';
      openRouteModal(initialModel, initialName);
    });
  }

  function renderRouteSearchDropdown(items) {
    if (!routeSearchDropdown) return;
    if (items.length === 0) {
      routeSearchDropdown.innerHTML = `
        <div class="px-4 py-3 text-xs text-slate-400 text-center">
          No matching trains found. You can also enter numeric train code (e.g. 702).
        </div>
      `;
      routeSearchDropdown.classList.remove('hidden');
      return;
    }

    routeSearchDropdown.innerHTML = items.slice(0, 15).map(t => `
      <div class="train-search-item px-4 py-2.5 cursor-pointer flex items-center justify-between text-xs hover:bg-emerald-50/70 dark:hover:bg-slate-700/60 transition group" data-model="${t.model}" data-name="${t.name}">
        <div class="flex items-center space-x-2.5">
          <div class="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition">
            <i class="fa-solid fa-train"></i>
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-extrabold text-slate-900 dark:text-white">${t.name}</span>
              <span class="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-[10px] border border-emerald-300 dark:border-emerald-700/60">#${t.model}</span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
              <i class="fa-solid fa-route text-[10px] text-emerald-500"></i>
              <span>${t.route || `${t.from} ➔ ${t.to}`}</span>
            </div>
          </div>
        </div>
        <span class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 group-hover:bg-emerald-600 group-hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-bold transition">
          View Route ➔
        </span>
      </div>
    `).join('');

    routeSearchDropdown.querySelectorAll('.train-search-item').forEach(item => {
      item.addEventListener('click', () => {
        const model = item.dataset.model;
        const name = item.dataset.name;
        routeTrainSearchInput.value = `${name} (#${model})`;
        routeSearchDropdown.classList.add('hidden');
        if (clearRouteSearchBtn) clearRouteSearchBtn.classList.remove('hidden');
        openRouteModal(model, name);
      });
    });

    routeSearchDropdown.classList.remove('hidden');
  }

  if (routeTrainSearchInput) {
    routeTrainSearchInput.addEventListener('input', () => {
      const q = routeTrainSearchInput.value.trim().toLowerCase();
      if (clearRouteSearchBtn) clearRouteSearchBtn.classList.toggle('hidden', !q);

      if (!q) {
        if (routeSearchDropdown) routeSearchDropdown.classList.add('hidden');
        return;
      }

      const matches = state.trainsCatalog.filter(t => 
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.model && t.model.includes(q)) ||
        (t.from && t.from.toLowerCase().includes(q)) ||
        (t.to && t.to.toLowerCase().includes(q)) ||
        (t.route && t.route.toLowerCase().includes(q))
      );

      renderRouteSearchDropdown(matches);
    });

    routeTrainSearchInput.addEventListener('focus', () => {
      const q = routeTrainSearchInput.value.trim().toLowerCase();
      if (q && routeSearchDropdown) {
        const matches = state.trainsCatalog.filter(t => 
          (t.name && t.name.toLowerCase().includes(q)) ||
          (t.model && t.model.includes(q)) ||
          (t.from && t.from.toLowerCase().includes(q)) ||
          (t.to && t.to.toLowerCase().includes(q)) ||
          (t.route && t.route.toLowerCase().includes(q))
        );
        renderRouteSearchDropdown(matches);
      }
    });

    routeTrainSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = routeTrainSearchInput.value.trim();
        if (routeSearchDropdown) routeSearchDropdown.classList.add('hidden');
        if (query) {
          const exact = state.trainsCatalog.find(t => 
            t.model === query || t.name.toLowerCase() === query.toLowerCase() || `${t.name} (#${t.model})`.toLowerCase() === query.toLowerCase()
          );
          if (exact) {
            openRouteModal(exact.model, exact.name);
          } else {
            const digits = query.replace(/\D/g, '');
            openRouteModal(digits || query);
          }
        }
      }
    });
  }

  if (clearRouteSearchBtn) {
    clearRouteSearchBtn.addEventListener('click', () => {
      routeTrainSearchInput.value = '';
      clearRouteSearchBtn.classList.add('hidden');
      if (routeSearchDropdown) routeSearchDropdown.classList.add('hidden');
      routeTrainSearchInput.focus();
    });
  }

  if (routeLookupSubmitBtn && routeTrainSearchInput) {
    routeLookupSubmitBtn.addEventListener('click', () => {
      const query = routeTrainSearchInput.value.trim();
      if (routeSearchDropdown) routeSearchDropdown.classList.add('hidden');
      if (query) {
        const exact = state.trainsCatalog.find(t => 
          t.model === query || t.name.toLowerCase() === query.toLowerCase() || `${t.name} (#${t.model})`.toLowerCase() === query.toLowerCase()
        );
        if (exact) {
          openRouteModal(exact.model, exact.name);
        } else {
          const digits = query.replace(/\D/g, '');
          openRouteModal(digits || query);
        }
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (routeSearchDropdown && !routeSearchDropdown.contains(e.target) && e.target !== routeTrainSearchInput) {
      routeSearchDropdown.classList.add('hidden');
    }
  });

  async function openRouteModal(trainModel, trainName = '') {
    if (!trainModel) return;
    const cleanModel = String(trainModel).replace(/\D/g, '') || String(trainModel).trim();

    routeModalTrainName.textContent = trainName || `Train #${cleanModel}`;
    routeModalTrainModel.textContent = `#${cleanModel}`;
    routeModalSubtitle.textContent = 'Fetching official schedule from Bangladesh Railway...';
    routeTotalDuration.textContent = 'Loading...';
    routeRunningDays.innerHTML = '';
    routeTimelineContainer.innerHTML = `
      <div class="py-12 text-center text-slate-400 space-y-2">
        <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500"></i>
        <p class="text-xs">Connecting to Bangladesh Railway Train Information Service...</p>
      </div>
    `;
    routeTrainSearchInput.value = cleanModel;
    routeModal.classList.remove('hidden');

    try {
      const token = getAuthToken();
      const res = await fetch(`/api/train-route?model=${encodeURIComponent(cleanModel)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const json = await res.json();

      if (!json.success || !json.data) {
        routeTimelineContainer.innerHTML = `
          <div class="py-8 text-center text-slate-400 space-y-2">
            <i class="fa-solid fa-triangle-exclamation text-xl text-amber-500"></i>
            <p class="text-xs font-semibold">${json.error || 'No route data found for this train model.'}</p>
            <p class="text-[11px] text-slate-400">Please verify the train number (e.g. 702, 704, 788, 814, 742).</p>
          </div>
        `;
        routeModalSubtitle.textContent = 'Schedule Not Available';
        return;
      }

      const routeData = json.data;
      const officialTrainName = routeData.train_name || trainName || `Train #${cleanModel}`;
      routeModalTrainName.textContent = officialTrainName;
      routeModalSubtitle.textContent = 'Official Bangladesh Railway Stoppage Timeline';
      routeTotalDuration.textContent = routeData.total_duration ? `${routeData.total_duration} Hours` : 'N/A';

      // Render Running Days & Off-Day Badge
      const allDays = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
      const activeDays = new Set(routeData.days || []);
      const offDayText = routeData.off_day || 'None';
      
      routeRunningDays.innerHTML = `
        <div class="flex items-center space-x-1 flex-wrap gap-1">
          ${allDays.map(d => {
            const isActive = activeDays.has(d);
            return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${isActive ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 opacity-50 line-through'}">${d}</span>`;
          }).join('')}
          <span class="ml-2 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${offDayText !== 'None' ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/80' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300'}">
            Off-Day: ${offDayText}
          </span>
        </div>
      `;

      // Render Vertical Station Timeline
      const stops = routeData.routes || [];
      if (stops.length === 0) {
        routeTimelineContainer.innerHTML = '<div class="py-6 text-center text-slate-400 text-xs">No stoppage station information available.</div>';
        return;
      }

      // Initialize Interactive Intermediate Stoppage Calculator
      initRouteCalculator(stops);

      routeTimelineContainer.innerHTML = stops.map((stop, idx) => {
        const isOrigin = idx === 0;
        const isDest = idx === stops.length - 1;
        const cityName = (stop.city || 'Station').replace(/_/g, ' ');
        const arrTime = stop.arrival_time || (isOrigin ? 'Origin Station' : '--');
        const depTime = stop.departure_time || (isDest ? 'Final Destination' : '--');
        const halt = stop.halt ? `${stop.halt} min halt` : (isOrigin || isDest ? '' : 'Brief stop');
        const duration = stop.duration ? `Travel: ${stop.duration}` : '';

        return `
          <div class="relative flex items-start space-x-3 pb-6 group">
            <!-- Node dot on timeline -->
            <div class="relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-sm transition ${
              isOrigin ? 'bg-emerald-600 text-white ring-4 ring-emerald-100 dark:ring-emerald-950' :
              isDest ? 'bg-rose-600 text-white ring-4 ring-rose-100 dark:ring-rose-950' :
              'bg-white dark:bg-slate-800 border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400'
            }">
              ${isOrigin ? '<i class="fa-solid fa-play text-[9px]"></i>' : isDest ? '<i class="fa-solid fa-flag-checkered text-[9px]"></i>' : (idx + 1)}
            </div>

            <!-- Station Card -->
            <div class="flex-1 bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700/60 shadow-xs hover:border-emerald-400 transition">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div class="flex items-center space-x-2">
                  <h4 class="font-extrabold text-sm text-slate-900 dark:text-white">${cityName}</h4>
                  ${isOrigin ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold uppercase">Origin</span>' : ''}
                  ${isDest ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold uppercase">Destination</span>' : ''}
                </div>
                
                <div class="flex items-center space-x-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  ${halt ? `<span class="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[10px]"><i class="fa-regular fa-clock mr-1"></i>${halt}</span>` : ''}
                  ${duration ? `<span class="text-slate-400 text-[10px]">${duration}</span>` : ''}
                </div>
              </div>

              <!-- Arrival / Departure Timings -->
              <div class="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50 text-xs">
                <div>
                  <span class="text-[10px] text-slate-400 uppercase font-semibold">Arrival</span>
                  <p class="font-extrabold text-slate-800 dark:text-slate-200">${arrTime}</p>
                </div>
                <div class="text-right sm:text-left">
                  <span class="text-[10px] text-slate-400 uppercase font-semibold">Departure</span>
                  <p class="font-extrabold text-emerald-600 dark:text-emerald-400">${depTime}</p>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      console.warn('Train route fetch error:', err);
      routeTimelineContainer.innerHTML = `
        <div class="py-8 text-center text-slate-400 space-y-2">
          <i class="fa-solid fa-triangle-exclamation text-xl text-amber-500"></i>
          <p class="text-xs">Failed to load route information. Please try again.</p>
        </div>
      `;
    }
  }

  // ----------------------------------------------------
  // Intermediate Stoppage Duration & Halt Calculator
  // ----------------------------------------------------
  let currentModalRouteStops = [];

  function initRouteCalculator(stops) {
    currentModalRouteStops = stops;
    if (!routeCalcFromSelect || !routeCalcToSelect) return;

    const optionsHtml = stops.map((s, idx) => `
      <option value="${idx}">${s.city ? s.city.replace(/_/g, ' ') : `Station ${idx+1}`} (${s.departure_time || s.arrival_time || '--'})</option>
    `).join('');

    routeCalcFromSelect.innerHTML = optionsHtml;
    routeCalcToSelect.innerHTML = optionsHtml;

    routeCalcFromSelect.selectedIndex = 0;
    routeCalcToSelect.selectedIndex = Math.max(0, stops.length - 1);

    calculateIntermediateJourney();

    routeCalcFromSelect.onchange = calculateIntermediateJourney;
    routeCalcToSelect.onchange = calculateIntermediateJourney;
  }

  function calculateIntermediateJourney() {
    if (!currentModalRouteStops || currentModalRouteStops.length === 0) return;
    const fromIdx = parseInt(routeCalcFromSelect.value, 10);
    const toIdx = parseInt(routeCalcToSelect.value, 10);

    if (isNaN(fromIdx) || isNaN(toIdx) || fromIdx >= toIdx) {
      if (routeCalcResultRibbon) routeCalcResultRibbon.classList.add('hidden');
      return;
    }

    const fromStop = currentModalRouteStops[fromIdx];
    const toStop = currentModalRouteStops[toIdx];

    const intermediateStopsCount = toIdx - fromIdx - 1;
    let totalHaltMinutes = 0;

    for (let i = fromIdx + 1; i < toIdx; i++) {
      totalHaltMinutes += parseInt(currentModalRouteStops[i].halt, 10) || 2;
    }

    let durationText = 'N/A';
    if (fromStop.departure_time && toStop.arrival_time) {
      const depMins = parseTimeToMinutes(fromStop.departure_time);
      const arrMins = parseTimeToMinutes(toStop.arrival_time);
      if (depMins !== null && arrMins !== null) {
        let diff = arrMins - depMins;
        if (diff < 0) diff += 24 * 60; // Crosses midnight
        const hrs = Math.floor(diff / 60);
        const mins = diff % 60;
        durationText = `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
      }
    }

    if (routeCalcDuration) routeCalcDuration.textContent = durationText;
    if (routeCalcStopsCount) routeCalcStopsCount.textContent = `${intermediateStopsCount} stop(s)`;
    if (routeCalcHaltTime) routeCalcHaltTime.textContent = `${totalHaltMinutes} mins`;
    if (routeCalcResultRibbon) routeCalcResultRibbon.classList.remove('hidden');
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = timeStr.trim();
    const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return null;
    let hrs = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;
    if (ampm === 'PM' && hrs < 12) hrs += 12;
    if (ampm === 'AM' && hrs === 12) hrs = 0;
    return hrs * 60 + mins;
  }

  // ----------------------------------------------------
  // View Switchers (Cards, Table, 10-Day Matrix)
  // ----------------------------------------------------
  if (viewGridBtn) {
    viewGridBtn.addEventListener('click', () => {
      state.viewMode = 'grid';
      viewGridBtn.className = 'px-2 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm transition';
      viewTableBtn.className = 'px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      if (viewMatrixBtn) viewMatrixBtn.className = 'px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      if (trainsMatrixView) trainsMatrixView.classList.add('hidden');
      if (state.lastSearchData) renderResults(state.lastSearchData);
    });
  }

  if (viewTableBtn) {
    viewTableBtn.addEventListener('click', () => {
      state.viewMode = 'table';
      viewTableBtn.className = 'px-2 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm transition';
      viewGridBtn.className = 'px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      if (viewMatrixBtn) viewMatrixBtn.className = 'px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
      if (trainsMatrixView) trainsMatrixView.classList.add('hidden');
      if (state.lastSearchData) renderResults(state.lastSearchData);
    });
  }

  function activateMatrixView() {
    state.viewMode = 'matrix';
    if (viewMatrixBtn) viewMatrixBtn.className = 'px-2 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm transition';
    if (viewGridBtn) viewGridBtn.className = 'px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
    if (viewTableBtn) viewTableBtn.className = 'px-2 py-1 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
    showMatrixReadyState();

    // Auto-scroll to matrix view container
    if (trainsMatrixView) {
      trainsMatrixView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (viewMatrixBtn) {
    viewMatrixBtn.addEventListener('click', activateMatrixView);
  }

  if (quickMatrixViewBtn) {
    quickMatrixViewBtn.addEventListener('click', () => {
      const rawFrom = fromStationInput.value.trim();
      const rawTo = toStationInput.value.trim();
      state.selectedFrom = getCanonicalStationName(rawFrom);
      state.selectedTo = getCanonicalStationName(rawTo);
      fromStationInput.value = state.selectedFrom;
      toStationInput.value = state.selectedTo;

      activateMatrixView();

      // If valid route selected, trigger matrix scan
      if (state.selectedFrom && state.selectedTo && state.selectedFrom.toLowerCase() !== state.selectedTo.toLowerCase() && state.isAuthenticated) {
        fetchAndRenderMultiDayMatrix();
      }
    });
  }

  // ----------------------------------------------------
  // Customizable Multi-Day Calendar Matrix View
  // ----------------------------------------------------
  function showMatrixReadyState() {
    if (trainsGrid) trainsGrid.classList.add('hidden');
    if (trainsTableView) trainsTableView.classList.add('hidden');
    if (trainsMatrixView) trainsMatrixView.classList.remove('hidden');

    // Reset start date to today/selected if not set
    const defaultDate = state.selectedDate || new Date().toISOString().split('T')[0];
    if (matrixStartDateInput && !matrixStartDateInput.value) {
      matrixStartDateInput.value = defaultDate;
    }
    if (calendarMatrixTitle) {
      calendarMatrixTitle.textContent = 'Multi-Day Availability Matrix';
    }

    if (matrixContentContainer) {
      const from = state.selectedFrom || '—';
      const to = state.selectedTo || '—';
      matrixContentContainer.innerHTML = `
        <div class="py-14 text-center space-y-4">
          <div class="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-3xl text-emerald-500">
            <i class="fa-solid fa-calendar-days"></i>
          </div>
          <div>
            <p class="text-sm font-extrabold text-slate-800 dark:text-white">${from} ➔ ${to}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Choose how many days to scan using the controls above,<br>then click <strong class="text-emerald-600 dark:text-emerald-400">⟳ Scan</strong> to load live availability.</p>
          </div>
          <p class="text-[11px] text-slate-400">Supports 1 – 14 days &bull; Max 14 days per scan</p>
        </div>
      `;
    }
  }

  function initMultiDayMatrixControls() {
    if (matrixDaysPresetGroup) {
      matrixDaysPresetGroup.querySelectorAll('.matrix-day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const days = parseInt(btn.dataset.days, 10) || 7;
          state.matrixDays = days;
          if (matrixCustomDaysInput) matrixCustomDaysInput.value = days;
          updateMatrixDayBtnStyles(days);
          // Preset pill click does trigger a scan
          fetchAndRenderMultiDayMatrix();
        });
      });
    }

    if (matrixCustomDaysInput) {
      // Only update state, don't auto-scan on typing
      matrixCustomDaysInput.addEventListener('input', () => {
        let val = parseInt(matrixCustomDaysInput.value, 10);
        if (!isNaN(val)) {
          if (val < 1) val = 1;
          if (val > 14) val = 14;
          state.matrixDays = val;
          updateMatrixDayBtnStyles(val);
        }
      });
    }

    if (matrixStartDateInput) {
      // Only update state, don't auto-scan on date change
      matrixStartDateInput.addEventListener('change', () => {
        state.matrixStartDate = matrixStartDateInput.value;
      });
    }

    if (matrixRefreshBtn) {
      // Scan button is the only trigger
      matrixRefreshBtn.addEventListener('click', () => {
        let val = parseInt(matrixCustomDaysInput ? matrixCustomDaysInput.value : state.matrixDays, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 14) val = 14;
        if (matrixCustomDaysInput) matrixCustomDaysInput.value = val;
        state.matrixDays = val;
        updateMatrixDayBtnStyles(val);
        fetchAndRenderMultiDayMatrix();
      });
    }
  }

  function updateMatrixDayBtnStyles(selectedDays) {
    if (!matrixDaysPresetGroup) return;
    matrixDaysPresetGroup.querySelectorAll('.matrix-day-btn').forEach(btn => {
      const d = parseInt(btn.dataset.days, 10);
      if (d === selectedDays) {
        btn.className = 'matrix-day-btn px-2 py-0.5 rounded-md font-bold transition bg-emerald-600 text-white shadow-2xs cursor-pointer';
      } else {
        btn.className = 'matrix-day-btn px-2 py-0.5 rounded-md font-bold transition text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer';
      }
    });
  }

  async function fetchAndRenderMultiDayMatrix(customDays, customStartDate) {
    if (!state.selectedFrom || !state.selectedTo) {
      showToast('Please select both departure and destination stations first.', 'info');
      return;
    }

    if (trainsGrid) trainsGrid.classList.add('hidden');
    if (trainsTableView) trainsTableView.classList.add('hidden');
    if (trainsMatrixView) trainsMatrixView.classList.remove('hidden');
    
    const numDays = customDays || state.matrixDays || 7;
    const startD = customStartDate || (matrixStartDateInput && matrixStartDateInput.value ? matrixStartDateInput.value : '') || state.selectedDate || new Date().toISOString().split('T')[0];

    if (matrixStartDateInput && !matrixStartDateInput.value) {
      matrixStartDateInput.value = startD;
    }
    if (matrixCustomDaysInput) {
      matrixCustomDaysInput.value = numDays;
    }
    updateMatrixDayBtnStyles(numDays);

    if (calendarMatrixTitle) {
      calendarMatrixTitle.textContent = `${numDays}-Day Availability Matrix`;
    }

    if (matrixContentContainer) {
      matrixContentContainer.innerHTML = `
        <div class="py-12 text-center text-slate-400 space-y-3">
          <i class="fa-solid fa-spinner fa-spin text-3xl text-emerald-500"></i>
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">Querying next ${numDays} consecutive days for ${state.selectedFrom} ➔ ${state.selectedTo}...</p>
          <p class="text-[11px] text-slate-400">Loading live availability across all trains from Bangladesh Railway</p>
        </div>
      `;
    }

    try {
      const token = getAuthToken();
      const res = await fetch(`/api/multi-date-search?from_city=${encodeURIComponent(state.selectedFrom)}&to_city=${encodeURIComponent(state.selectedTo)}&start_date=${encodeURIComponent(startD)}&days=${encodeURIComponent(numDays)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();

      if (!data.success || !data.matrix || data.matrix.length === 0) {
        if (matrixContentContainer) {
          matrixContentContainer.innerHTML = `
            <div class="py-8 text-center text-slate-400 space-y-2">
              <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-500"></i>
              <p class="text-xs font-bold text-slate-700 dark:text-slate-200">Unable to load ${numDays}-day matrix</p>
              <p class="text-[11px] text-slate-400">${data.error || 'Please ensure your live API session is connected.'}</p>
            </div>
          `;
        }
        return;
      }

      state.multiDateData = data;
      renderMatrixTable(data.matrix);

    } catch (err) {
      console.warn('Matrix fetch error:', err);
      if (matrixContentContainer) {
        matrixContentContainer.innerHTML = '<div class="py-8 text-center text-xs text-rose-500">Failed to load multi-date matrix. Please try again.</div>';
      }
    }
  }

  function renderMatrixTable(matrixDays) {
    if (!matrixContentContainer) return;

    const trainMap = new Map();
    matrixDays.forEach(day => {
      (day.trains || []).forEach(t => {
        if (!trainMap.has(t.train_model)) {
          trainMap.set(t.train_model, {
            name: t.train_name,
            model: t.train_model,
            departure_time: t.departure_time,
            arrival_time: t.arrival_time,
            off_day: t.off_day
          });
        }
      });
    });

    const uniqueTrains = Array.from(trainMap.values());

    let tableHtml = `
      <table class="w-full text-left text-xs border-separate border-spacing-0 min-w-[650px]">
        <thead>
          <tr class="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-extrabold">
            <th class="p-3 whitespace-nowrap sticky left-0 bg-slate-100 dark:bg-slate-800 z-20 sticky-column-shadow border-r-2 border-b-2 border-slate-200 dark:border-slate-700">Train</th>
            ${matrixDays.map(d => `
              <th class="p-2.5 text-center whitespace-nowrap cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition matrix-header-date border-r border-b-2 border-slate-200 dark:border-slate-700" data-date="${d.date}" title="Switch to this date">
                <div class="text-[10px] text-slate-400 font-mono">${d.day_name}</div>
                <div class="text-xs font-black text-slate-900 dark:text-white">${d.display_date}</div>
                <div class="text-[9px] font-black ${d.total_available_seats > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">
                  ${d.total_available_seats > 0 ? `🟢 ${d.total_available_seats}` : '🔴 0'}
                </div>
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody class="font-medium">
    `;

    uniqueTrains.forEach(train => {
      tableHtml += `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
          <td class="p-3 font-bold text-slate-900 dark:text-white whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900 z-10 sticky-column-shadow border-r-2 border-b-2 border-slate-200 dark:border-slate-700">
            <div class="text-xs font-black">${train.name}</div>
            <div class="text-[10px] text-slate-400 font-normal">#${train.model} &bull; ${train.departure_time} &bull; Off: ${train.off_day || 'None'}</div>
          </td>
      `;

      matrixDays.forEach(d => {
        const trainOnDay = (d.trains || []).find(t => t.train_model === train.model);
        if (!trainOnDay) {
          tableHtml += `
            <td class="p-2 text-center text-[10px] text-slate-400 dark:text-slate-600 bg-slate-50/50 dark:bg-slate-800/20 font-medium border-r border-b border-slate-100 dark:border-slate-800/60">
              Off Day
            </td>
          `;
        } else {
          const totalSeats = trainOnDay.total_seats || 0;
          let cellBg = '';
          let badgeText = '';

          if (totalSeats > 10) {
            cellBg = 'bg-emerald-50 hover:bg-emerald-100 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 border-2 border-emerald-400 dark:border-emerald-700';
            badgeText = `🟢 ${totalSeats}`;
          } else if (totalSeats > 0) {
            cellBg = 'bg-amber-50 hover:bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-200 border-2 border-amber-400 dark:border-amber-700';
            badgeText = `🟡 ${totalSeats}`;
          } else {
            cellBg = 'bg-rose-50/60 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-2 border-rose-200 dark:border-rose-900/60';
            badgeText = '🔴 0';
          }

          const classBreakdown = (trainOnDay.seat_types || []).map(st => `${st.display_name}: ${st.total_seats} (৳${st.total_fare})`).join('\n');

          tableHtml += `
            <td class="p-1.5 text-center cursor-pointer matrix-cell-click border-r border-b border-slate-100 dark:border-slate-800/60" data-date="${d.date}" data-train-model="${train.model}" title="${classBreakdown}">
              <div class="px-2 py-1 rounded-lg text-[11px] font-black shadow-2xs transition ${cellBg}">
                ${badgeText}
              </div>
            </td>
          `;
        }
      });

      tableHtml += `</tr>`;
    });

    tableHtml += `
        </tbody>
      </table>
    `;

    matrixContentContainer.innerHTML = tableHtml;

    // Delegate click to switch date
    matrixContentContainer.querySelectorAll('.matrix-header-date, .matrix-cell-click').forEach(el => {
      el.addEventListener('click', () => {
        const targetDate = el.dataset.date;
        if (targetDate) {
          state.selectedDate = targetDate;
          journeyDateInput.value = targetDate;
          if (viewGridBtn) viewGridBtn.click();
          executeSearch();
          showToast(`Switched to ${formatShohozDoj(targetDate)}`, 'info');
        }
      });
    });
  }

  // ----------------------------------------------------
  // Telegram 1-Click Login & Alert Module (@railseatfinderbdbot)
  // ----------------------------------------------------

  let activePairCode = null;
  let pairStatusCheckTimer = null;

  function getTelegramConfig() {
    try {
      const raw = localStorage.getItem('rail_telegram_config');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function saveTelegramConfig(chat_id, username = '', first_name = '') {
    localStorage.setItem('rail_telegram_config', JSON.stringify({ chat_id, username, first_name }));
  }

  function clearTelegramConfig() {
    localStorage.removeItem('rail_telegram_config');
  }

  function updateTelegramBadge() {
    const cfg = getTelegramConfig();
    if (telegramStatusBadge) {
      if (cfg && cfg.chat_id) {
        telegramStatusBadge.classList.remove('hidden');
      } else {
        telegramStatusBadge.classList.add('hidden');
      }
    }
  }

  async function updateTelegramUI() {
    const cfg = getTelegramConfig();
    updateTelegramBadge();

    if (cfg && cfg.chat_id) {
      // CONNECTED STATE
      if (telegramDisconnectedCard) telegramDisconnectedCard.classList.add('hidden');
      if (telegramConnectedCard) telegramConnectedCard.classList.remove('hidden');

      if (telegramConnectedUserLabel) {
        telegramConnectedUserLabel.textContent = cfg.username ? `${cfg.username} (${cfg.first_name || 'User'})` : (cfg.first_name || 'Connected');
      }
      if (telegramConnectedChatIdBadge) {
        telegramConnectedChatIdBadge.textContent = `ID: ${cfg.chat_id}`;
      }
      if (telegramSetupStatus) telegramSetupStatus.textContent = '';
      if (pairStatusCheckTimer) clearInterval(pairStatusCheckTimer);
    } else {
      // DISCONNECTED STATE -> Prepare 1-Click Login
      if (telegramConnectedCard) telegramConnectedCard.classList.add('hidden');
      if (telegramDisconnectedCard) telegramDisconnectedCard.classList.remove('hidden');

      await requestNewTelegramPairCode();
    }
  }

  async function requestNewTelegramPairCode() {
    try {
      if (telegramPairingSpinner) telegramPairingSpinner.classList.remove('hidden');
      const res = await fetch('/api/telegram/generate-pair-code', { method: 'POST' });
      const data = await res.json();

      if (data.success && data.pair_code) {
        activePairCode = data.pair_code;
        if (telegramPairCodeDisplay) telegramPairCodeDisplay.textContent = data.pair_code;
        if (telegramLoginBtn) telegramLoginBtn.href = data.direct_url;

        startPairStatusPoller(data.pair_code);
      }
    } catch (e) {
      console.warn('[Telegram] Could not generate pairing code:', e.message);
    } finally {
      if (telegramPairingSpinner) telegramPairingSpinner.classList.add('hidden');
    }
  }

  function startPairStatusPoller(code) {
    if (pairStatusCheckTimer) clearInterval(pairStatusCheckTimer);

    pairStatusCheckTimer = setInterval(async () => {
      const cfg = getTelegramConfig();
      if (cfg && cfg.chat_id) {
        clearInterval(pairStatusCheckTimer);
        return;
      }

      try {
        const res = await fetch(`/api/telegram/pair-status?code=${encodeURIComponent(code)}`);
        const data = await res.json();

        if (data.success && data.paired && data.chat_id) {
          clearInterval(pairStatusCheckTimer);
          saveTelegramConfig(data.chat_id, data.username, data.first_name);
          showToast(`🎉 Telegram Connected as ${data.username || data.first_name || 'User'}!`, 'success');
          await updateTelegramUI();
        }
      } catch (e) {
        // Silently ignore transient check error
      }
    }, 2500);
  }

  async function sendTelegramAlert(alertData) {
    const cfg = getTelegramConfig();
    if (!cfg || !cfg.chat_id) return; // Silently skip if not configured

    const { trainName, trainModel, className, seats, fromCity, toCity, date, bookUrl, isRadarHit } = alertData;
    const canonicalFrom = getCanonicalStationName(fromCity || state.selectedFrom || 'Dhaka');
    const canonicalTo = getCanonicalStationName(toCity || state.selectedTo || 'Chattogram');
    const canonicalDoj = formatShohozDoj(date || state.selectedDate || new Date().toISOString().split('T')[0]);
    const finalBookUrl = bookUrl || buildShohozBookingUrl(canonicalFrom, canonicalTo, canonicalDoj, className);

    const message = isRadarHit ? 
`🎯 <b>WATCHLIST RADAR TARGET HIT!</b> 🎯
━━━━━━━━━━━━━━━━━━━
🚆 <b>Train:</b> ${trainName} (#${trainModel})
💺 <b>Class:</b> <b>${className}</b>
🟢 <b>Seats:</b> <b>${seats} AVAILABLE TO BUY!</b>

📍 <b>Route:</b> ${canonicalFrom} ➔ ${canonicalTo}
📅 <b>Date:</b> ${canonicalDoj}
━━━━━━━━━━━━━━━━━━━
⚡ <i>Book immediately before seats sell out!</i>
🔗 <a href="${finalBookUrl}">🎟️ Click to Book Now on Railway</a>`
:
`🚨 <b>SEAT RELEASED ON ROUTE</b>
━━━━━━━━━━━━━━━━━━━
🚆 <b>Train:</b> ${trainName} (#${trainModel})
🪑 <b>Class:</b> ${className}
🟢 <b>Seats:</b> <b>${seats} available</b>

📍 <b>Route:</b> ${canonicalFrom} ➔ ${canonicalTo}
📅 <b>Date:</b> ${canonicalDoj}
━━━━━━━━━━━━━━━━━━━
🔗 <a href="${finalBookUrl}">🎟️ Book Now on Railway</a>`;

    try {
      await fetch('/api/telegram/send-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chat_id,
          message,
          bookUrl: finalBookUrl
        })
      });
    } catch (e) {
      console.warn('[Telegram] Failed to send alert:', e.message);
    }
  }

  function initTelegramSetup() {
    updateTelegramUI();

    // 1. Quick Check / Refresh Button
    if (telegramQuickCheckBtn) {
      telegramQuickCheckBtn.addEventListener('click', async () => {
        if (activePairCode) {
          try {
            telegramQuickCheckBtn.textContent = 'Checking...';
            const res = await fetch(`/api/telegram/pair-status?code=${encodeURIComponent(activePairCode)}`);
            const data = await res.json();
            if (data.success && data.paired && data.chat_id) {
              saveTelegramConfig(data.chat_id, data.username, data.first_name);
              showToast(`🎉 Telegram Connected as ${data.username || data.first_name || 'User'}!`, 'success');
              await updateTelegramUI();
              return;
            } else {
              showToast('Not paired yet. Click "Login with Telegram" and press START in Telegram.', 'info');
            }
          } catch (e) {
            showToast('Error checking status.', 'error');
          } finally {
            telegramQuickCheckBtn.textContent = 'Check / Refresh';
          }
        } else {
          await requestNewTelegramPairCode();
        }
      });
    }

    // 2. Manual Save Button
    if (telegramManualSaveBtn) {
      telegramManualSaveBtn.addEventListener('click', () => {
        const val = telegramManualChatId ? telegramManualChatId.value.trim() : '';
        if (!val) {
          if (telegramSetupStatus) {
            telegramSetupStatus.textContent = '⚠️ Please enter a valid numeric Chat ID.';
            telegramSetupStatus.className = 'text-[10px] font-semibold text-center text-rose-600';
          }
          return;
        }
        saveTelegramConfig(val, '', 'Custom User');
        showToast('✅ Saved Chat ID manually!', 'success');
        updateTelegramUI();
      });
    }

    // 3. Send Test Alert Button
    if (telegramSendTestAlertBtn) {
      telegramSendTestAlertBtn.addEventListener('click', async () => {
        const cfg = getTelegramConfig();
        if (!cfg || !cfg.chat_id) {
          showToast('Please connect Telegram first.', 'error');
          return;
        }

        telegramSendTestAlertBtn.disabled = true;
        telegramSendTestAlertBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[9px] mr-1"></i> Sending...';
        if (telegramSetupStatus) telegramSetupStatus.textContent = '';

        try {
          const res = await fetch('/api/telegram/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: cfg.chat_id })
          });
          const data = await res.json();
          if (data.success) {
            if (telegramSetupStatus) {
              telegramSetupStatus.textContent = '✅ Test message sent! Check your Telegram app.';
              telegramSetupStatus.className = 'text-[10px] font-semibold text-center text-emerald-600';
            }
            showToast('📨 Test message sent to your Telegram!', 'success');
          } else {
            if (telegramSetupStatus) {
              telegramSetupStatus.textContent = `❌ ${data.error || 'Test failed.'}`;
              telegramSetupStatus.className = 'text-[10px] font-semibold text-center text-rose-600';
            }
            showToast(data.error || 'Test failed.', 'error');
          }
        } catch (e) {
          if (telegramSetupStatus) {
            telegramSetupStatus.textContent = '❌ Network error.';
            telegramSetupStatus.className = 'text-[10px] font-semibold text-center text-rose-600';
          }
        } finally {
          telegramSendTestAlertBtn.disabled = false;
          telegramSendTestAlertBtn.innerHTML = '<i class="fa-solid fa-paper-plane text-[9px] mr-1"></i> Send Test Alert';
        }
      });
    }

    // 4. Disconnect Button
    if (telegramDisconnectBtn) {
      telegramDisconnectBtn.addEventListener('click', () => {
        clearTelegramConfig();
        if (telegramManualChatId) telegramManualChatId.value = '';
        if (telegramSetupStatus) {
          telegramSetupStatus.textContent = 'Telegram disconnected.';
          telegramSetupStatus.className = 'text-[10px] font-semibold text-center text-slate-500';
        }
        showToast('Telegram disconnected.', 'info');
        updateTelegramUI();
      });
    }
  }

  // ----------------------------------------------------
  // Targeted Train & Seat Class Watchlist Radar (24/7 Server Synced)
  // ----------------------------------------------------
  // Targeted Train & Seat Class Watchlist Radar (24/7 Server-Side User-Wise Synced)
  // ----------------------------------------------------
  async function loadUserWatchlistFromServer() {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/radar/watchlist', {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.targets)) {
        state.watchlist = data.targets;
        updateWatchlistUI();
        if (watchlistModal && !watchlistModal.classList.contains('hidden')) {
          renderWatchlistModal();
        }
      }
    } catch (e) {
      console.warn('[Radar] Error loading user watchlist:', e.message);
    }
  }

  async function syncWatchlistWithServer() {
    try {
      const tgConfig = getTelegramConfig();
      const token = getAuthToken();
      await fetch('/api/radar/watchlist/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          targets: state.watchlist,
          telegramChatId: tgConfig ? tgConfig.chat_id : null,
          telegramUsername: tgConfig ? tgConfig.username : null
        })
      });
    } catch (e) {
      console.warn('[Radar] Background sync error:', e.message);
    }
  }

  function saveWatchlist() {
    try {
      localStorage.setItem('railway_watchlist', JSON.stringify(state.watchlist));
      syncWatchlistWithServer();
    } catch (e) {}
  }

  function initWatchlist() {
    updateWatchlistUI();
    initTelegramSetup();
    loadUserWatchlistFromServer();

    if (openWatchlistBtn) {
      openWatchlistBtn.addEventListener('click', () => {
        loadUserWatchlistFromServer();
        renderWatchlistModal();
        if (watchlistModal) watchlistModal.classList.remove('hidden');
      });
    }

    if (watchlistCloseBtn && watchlistModal) {
      watchlistCloseBtn.addEventListener('click', () => {
        watchlistModal.classList.add('hidden');
      });
    }

    if (watchlistModal) {
      watchlistModal.addEventListener('click', (e) => {
        if (e.target === watchlistModal) watchlistModal.classList.add('hidden');
      });
    }

    if (clearWatchlistBtn) {
      clearWatchlistBtn.addEventListener('click', () => {
        if (confirm('Clear all watched targets from your watchlist?')) {
          state.watchlist = [];
          saveWatchlist();
          updateWatchlistUI();
          renderWatchlistModal();
          showToast('Watchlist cleared.', 'info');
        }
      });
    }

    if (setWatchCloseBtn && setWatchTargetModal) {
      setWatchCloseBtn.addEventListener('click', () => {
        setWatchTargetModal.classList.add('hidden');
      });
    }

    if (setWatchTargetModal) {
      setWatchTargetModal.addEventListener('click', (e) => {
        if (e.target === setWatchTargetModal) setWatchTargetModal.classList.add('hidden');
      });
    }

    document.querySelectorAll('.watch-min-seat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.watch-min-seat-btn').forEach(b => {
          b.className = 'watch-min-seat-btn py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs';
        });
        btn.className = 'watch-min-seat-btn py-1 rounded-lg border border-emerald-500 bg-emerald-600 text-white font-bold text-xs';
        if (state.pendingWatchTarget) {
          state.pendingWatchTarget.minSeats = parseInt(btn.dataset.seats, 10);
        }
      });
    });

    if (watchMultiDateGrid) {
      watchMultiDateGrid.addEventListener('click', (e) => {
        const chip = e.target.closest('.watch-date-chip');
        if (!chip || !state.pendingWatchTarget) return;
        const dStr = chip.dataset.date;
        if (!dStr) return;

        const currentSelected = state.pendingWatchTarget.dates || [];
        if (currentSelected.includes(dStr)) {
          if (currentSelected.length > 1) {
            state.pendingWatchTarget.dates = currentSelected.filter(d => d !== dStr);
          } else {
            showToast('At least one travel date must remain selected.', 'warning');
            return;
          }
        } else {
          state.pendingWatchTarget.dates.push(dStr);
          state.pendingWatchTarget.dates.sort();
        }
        renderWatchMultiDateGrid();
      });
    }

    if (watchSelectAdvanceDatesBtn) {
      watchSelectAdvanceDatesBtn.addEventListener('click', () => {
        if (state.pendingWatchTarget && state.pendingWatchTarget.availableDates) {
          // Select only the 10 advance booking days (without today)
          state.pendingWatchTarget.dates = state.pendingWatchTarget.availableDates.slice(1);
          renderWatchMultiDateGrid();
        }
      });
    }

    if (watchSelectAllDatesBtn) {
      watchSelectAllDatesBtn.addEventListener('click', () => {
        if (state.pendingWatchTarget && state.pendingWatchTarget.availableDates) {
          state.pendingWatchTarget.dates = [...state.pendingWatchTarget.availableDates];
          renderWatchMultiDateGrid();
        }
      });
    }

    if (watchResetTodayDateBtn) {
      watchResetTodayDateBtn.addEventListener('click', () => {
        if (state.pendingWatchTarget && state.pendingWatchTarget.availableDates) {
          state.pendingWatchTarget.dates = [state.selectedDate || state.pendingWatchTarget.availableDates[0]];
          renderWatchMultiDateGrid();
        }
      });
    }

    if (saveWatchTargetBtn) {
      saveWatchTargetBtn.addEventListener('click', () => {
        if (!state.pendingWatchTarget) return;
        const targetClass = watchTargetClassSelect ? watchTargetClassSelect.value : 'ANY';
        const tgConfig = getTelegramConfig();
        const selectedDates = (state.pendingWatchTarget.dates && Array.isArray(state.pendingWatchTarget.dates) && state.pendingWatchTarget.dates.length > 0)
          ? [...state.pendingWatchTarget.dates]
          : [state.selectedDate || new Date().toISOString().split('T')[0]];

        const item = {
          id: 'watch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          trainName: state.pendingWatchTarget.trainName,
          trainModel: state.pendingWatchTarget.trainModel,
          fromCity: state.selectedFrom || 'Dhaka',
          toCity: state.selectedTo || 'Chattogram',
          date: selectedDates[0],
          dates: selectedDates,
          className: targetClass,
          minSeats: state.pendingWatchTarget.minSeats || 1,
          telegramChatId: tgConfig ? tgConfig.chat_id : null,
          telegramUsername: tgConfig ? tgConfig.username : null,
          active: true,
          createdAt: Date.now()
        };

        state.watchlist.unshift(item);
        saveWatchlist();
        updateWatchlistUI();
        renderWatchlistModal();
        subscribeToClosedBrowserPush();
        if (setWatchTargetModal) setWatchTargetModal.classList.add('hidden');
        showToast(`🛰️ 24/7 Radar: Added ${item.trainName} (${item.className}) for ${selectedDates.length} travel date${selectedDates.length === 1 ? '' : 's'}! Background alerts active.`, 'success');
      });
    }
  }

  function updateWatchlistUI() {
    const activeCount = state.watchlist.filter(w => w.active).length;
    if (watchlistBadge) {
      if (activeCount > 0) {
        watchlistBadge.textContent = activeCount;
        watchlistBadge.classList.remove('hidden');
      } else {
        watchlistBadge.classList.add('hidden');
      }
    }
  }

  function renderWatchlistModal() {
    if (!watchlistItemsContainer) return;

    if (radarUserBadge) {
      if (state.currentUser && state.currentUser.username) {
        radarUserBadge.textContent = `@${state.currentUser.username}`;
        radarUserBadge.classList.remove('hidden');
      } else {
        radarUserBadge.classList.add('hidden');
      }
    }

    if (!state.watchlist || state.watchlist.length === 0) {
      watchlistItemsContainer.innerHTML = `
        <div class="py-10 text-center text-slate-400 space-y-2">
          <div class="w-10 h-10 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
            <i class="fa-solid fa-crosshairs text-base"></i>
          </div>
          <p class="text-xs font-bold text-slate-700 dark:text-slate-200">No Active Watchlist Targets</p>
          <p class="text-[11px] text-slate-400 max-w-xs mx-auto">
            Click the <span class="text-amber-600 font-bold">"Watch"</span> button on any train card in your search results to set target alert criteria for 24/7 background scanning.
          </p>
        </div>
      `;
      return;
    }

    watchlistItemsContainer.innerHTML = state.watchlist.map(item => {
      const datesList = Array.isArray(item.dates) && item.dates.length > 0 ? item.dates : [item.date];
      const datesBadges = datesList.map(d => `
        <span class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[10px] font-bold border border-slate-200 dark:border-slate-700 shadow-2xs">
          <i class="fa-regular fa-calendar text-[9px] mr-1 text-emerald-600 dark:text-emerald-400"></i>${formatShohozDoj(d)}
        </span>
      `).join(' ');

      return `
        <div class="py-3 flex items-center justify-between gap-2">
          <div class="flex items-center space-x-2.5 min-w-0 flex-1">
            <button type="button" class="toggle-watch-btn w-6 h-6 rounded-full flex items-center justify-center text-xs transition ${item.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}" data-id="${item.id}" title="${item.active ? 'Active (Click to Pause)' : 'Paused (Click to Resume)'}">
              <i class="fa-solid ${item.active ? 'fa-check' : 'fa-pause'} text-[10px]"></i>
            </button>
            <div class="min-w-0 space-y-1">
              <div class="flex items-center space-x-1.5 flex-wrap gap-y-1">
                <h5 class="font-extrabold text-xs text-slate-900 dark:text-white truncate">${item.trainName}</h5>
                <span class="text-[10px] font-mono text-slate-400 font-bold">#${item.trainModel}</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded font-bold ${item.className === 'ANY' ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}">${item.className}</span>
                <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">≥ ${item.minSeats} seats</span>
                ${datesList.length > 1 ? `<span class="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 font-mono">${datesList.length} Dates Monitored</span>` : ''}
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                <span>${item.fromCity} ➔ ${item.toCity}</span>
              </div>
              <div class="flex flex-wrap gap-1 pt-0.5">
                ${datesBadges}
              </div>
            </div>
          </div>
          <div class="flex items-center space-x-1 shrink-0">
            <button type="button" class="delete-watch-btn p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer" data-id="${item.id}" title="Delete Watch Target">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    watchlistItemsContainer.querySelectorAll('.toggle-watch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const target = state.watchlist.find(w => w.id === id);
        if (target) {
          target.active = !target.active;
          saveWatchlist();
          updateWatchlistUI();
          renderWatchlistModal();
        }
      });
    });

    watchlistItemsContainer.querySelectorAll('.delete-watch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        state.watchlist = state.watchlist.filter(w => w.id !== id);
        saveWatchlist();
        updateWatchlistUI();
        renderWatchlistModal();
        showToast('Target removed from watchlist.', 'info');
      });
    });
  }

  function renderWatchMultiDateGrid() {
    if (!watchMultiDateGrid || !state.pendingWatchTarget || !state.pendingWatchTarget.availableDates) return;
    const selected = state.pendingWatchTarget.dates || [];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const todayStr = getLocalDateIso(new Date());

    watchMultiDateGrid.innerHTML = state.pendingWatchTarget.availableDates.map((dateStr, idx) => {
      const isSelected = selected.includes(dateStr);
      const parts = dateStr.split('-');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const dayName = days[d.getDay()];
      const dayNum = d.getDate();
      const monthName = months[d.getMonth()];
      const isToday = (dateStr === todayStr || idx === 0);
      const advanceDay = idx; // 1 to 10 for advance days

      const activeClass = isSelected
        ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs font-bold ring-2 ring-emerald-400/40'
        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-800 font-medium';

      const badge = isToday
        ? `<span class="text-[8px] font-extrabold px-1 rounded mt-0.5 ${isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'}">Today</span>`
        : `<span class="text-[8px] font-extrabold px-1 rounded mt-0.5 ${isSelected ? 'bg-white/20 text-white' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'}">+${advanceDay}D Adv</span>`;

      return `
        <button type="button" class="watch-date-chip flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition cursor-pointer select-none ${activeClass}" data-date="${dateStr}">
          <span class="text-[9px] uppercase tracking-wider opacity-80">${dayName}</span>
          <span class="text-xs font-black">${dayNum}</span>
          <span class="text-[9px] opacity-80">${monthName}</span>
          ${badge}
        </button>
      `;
    }).join('');

    if (watchSelectedDatesCount) {
      const count = selected.length;
      const firstDate = state.pendingWatchTarget.availableDates[0];
      const hasToday = selected.includes(firstDate);
      let extraTag = '';
      if (count === 10 && !hasToday) {
        extraTag = ' (10 Advance Days)';
      } else if (count === 11) {
        extraTag = ' (Today + 10 Advance Days)';
      }
      watchSelectedDatesCount.textContent = `Selected: ${count} date${count === 1 ? '' : 's'}${extraTag}`;
    }
  }

  function openSetWatchModal(train) {
    if (!train) return;
    
    // Generate Today + 10 advance booking days in local time (11 dates total)
    const availableDates = [];
    const now = new Date();
    for (let i = 0; i <= 10; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      availableDates.push(`${yyyy}-${mm}-${dd}`);
    }

    state.pendingWatchTarget = {
      trainName: train.train_name,
      trainModel: train.train_model,
      minSeats: 1,
      availableDates: availableDates,
      dates: [state.selectedDate || availableDates[0]]
    };

    if (watchTargetTrainName) {
      watchTargetTrainName.textContent = `${train.train_name} (#${train.train_model})`;
    }
    if (watchTargetRouteDate) {
      watchTargetRouteDate.textContent = `${state.selectedFrom || 'Origin'} ➔ ${state.selectedTo || 'Destination'}`;
    }

    document.querySelectorAll('.watch-min-seat-btn').forEach((b, idx) => {
      if (idx === 0) {
        b.className = 'watch-min-seat-btn py-1 rounded-lg border border-emerald-500 bg-emerald-600 text-white font-bold text-xs';
      } else {
        b.className = 'watch-min-seat-btn py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs';
      }
    });

    renderWatchMultiDateGrid();

    if (setWatchTargetModal) setWatchTargetModal.classList.remove('hidden');
  }

  // ----------------------------------------------------
  // Real-Time Server-Side Radar Alert Listener
  // ----------------------------------------------------
  let lastRadarAlertPollTime = Date.now() - 30000;
  let isRadarAlertPolling = false;

  async function pollServerRadarAlerts() {
    if (isRadarAlertPolling) return;
    isRadarAlertPolling = true;

    try {
      const token = getAuthToken();
      const res = await fetch(`/api/radar/alerts?since=${lastRadarAlertPollTime}`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.alerts) && data.alerts.length > 0) {
          data.alerts.forEach(alert => {
            // Avoid duplicate notifications in this session
            const alreadyExists = state.notifications.some(n => 
              (n.id === alert.id) || 
              (n.trainModel === alert.trainModel && n.date === alert.date && n.className === alert.className && n.seats === alert.seats && Math.abs((n.timestamp || 0) - alert.timestamp) < 15000)
            );

            if (!alreadyExists) {
              const isReleased = (alert.type === 'SOLD_OUT_RELEASED');

              // 1. Add to Top Menu Notification Center
              addStoredNotification({
                id: alert.id,
                title: alert.title || (isReleased ? '🚨 RELEASED!' : '🎯 Watchlist Radar Hit!'),
                message: alert.message || `${alert.seats} seat(s) available on ${alert.trainName}`,
                trainName: alert.trainName,
                trainModel: alert.trainModel,
                className: alert.className,
                seats: alert.seats,
                fromCity: alert.fromCity,
                toCity: alert.toCity,
                date: alert.date,
                bookUrl: alert.bookUrl,
                timestamp: alert.timestamp || Date.now(),
                type: isReleased ? 'SEAT_RELEASED' : 'RADAR_HIT'
              });

              // 2. Play Audio Sound Alert
              if (isReleased) {
                playUrgentAlertChime();
              } else {
                playRadarHitSound();
              }

              // 3. Display High-Priority Floating Toast
              if (isReleased) {
                showSoldOutReleasedToast(alert.trainName, alert.className, alert.seats, alert.bookUrl);
              } else {
                showRadarHitToast(alert.trainName, alert.className, alert.seats, alert.bookUrl);
              }

              // 4. Send Desktop OS Alert (even when browser tab is minimized)
              sendDesktopNotification(
                alert.title || (isReleased ? '🚨 RELEASED!' : '🎯 Watchlist Radar Hit!'),
                `${alert.trainName} (${alert.className}): ${alert.seats} seat(s) available on ${formatShohozDoj(alert.date)} for ${alert.fromCity} ➔ ${alert.toCity}`,
                alert.bookUrl
              );
            }
          });
        }

        if (data.serverTime) {
          lastRadarAlertPollTime = data.serverTime;
        }
      }
    } catch (e) {
      // Silent error in background polling
    } finally {
      isRadarAlertPolling = false;
    }
  }

  // Poll server radar alerts every 4 seconds in the open dashboard
  setInterval(pollServerRadarAlerts, 4000);
  setTimeout(pollServerRadarAlerts, 1500);

  // ----------------------------------------------------
  // Live Auto-Monitor Countdown & Pause/Resume
  // ----------------------------------------------------
  function startMonitorCountdownTicker() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }

    if (state.pollingInterval <= 0) {
      if (monitorTickerContainer) monitorTickerContainer.classList.add('hidden');
      return;
    }

    state.monitorCountdown = state.pollingInterval;
    if (monitorTickerContainer) monitorTickerContainer.classList.remove('hidden');
    updateCountdownUI();

    state.countdownTimer = setInterval(() => {
      if (state.isMonitorPaused) return;

      state.monitorCountdown--;
      if (state.monitorCountdown <= 0) {
        state.monitorCountdown = state.pollingInterval;
        if (state.selectedFrom && state.selectedTo && !state.isLoading && state.isAuthenticated) {
          executeSearch(true);
        }
      }
      updateCountdownUI();
    }, 1000);
  }

  function updateCountdownUI() {
    if (!monitorCountdownLabel || !monitorProgressBar) return;
    monitorCountdownLabel.textContent = `${state.monitorCountdown}s`;
    const pct = Math.max(0, Math.min(100, (state.monitorCountdown / Math.max(1, state.pollingInterval)) * 100));
    monitorProgressBar.style.width = `${pct}%`;
  }

  if (monitorPauseResumeBtn) {
    monitorPauseResumeBtn.addEventListener('click', () => {
      state.isMonitorPaused = !state.isMonitorPaused;
      if (monitorPauseIcon) {
        monitorPauseIcon.className = state.isMonitorPaused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
      }
      showToast(state.isMonitorPaused ? '⏸️ Auto-monitor paused' : '▶️ Auto-monitor resumed', 'info');
    });
  }

  // ----------------------------------------------------
  // 1-Click Seat Summary Share (WhatsApp & Clipboard)
  // ----------------------------------------------------
  function initShareModule() {
    if (shareResultsBtn) {
      shareResultsBtn.addEventListener('click', () => {
        openShareModal();
      });
    }

    if (shareCloseBtn && shareModal) {
      shareCloseBtn.addEventListener('click', () => {
        shareModal.classList.add('hidden');
      });
    }

    if (shareModal) {
      shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) shareModal.classList.add('hidden');
      });
    }

    if (copyShareSummaryBtn && sharePreviewTextarea) {
      copyShareSummaryBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(sharePreviewTextarea.value);
          showToast('📋 Availability summary copied to clipboard!', 'success');
        } catch (e) {
          sharePreviewTextarea.select();
          document.execCommand('copy');
          showToast('📋 Copied!', 'success');
        }
      });
    }
  }

  function openShareModal() {
    const text = generateShareSummaryText();
    if (sharePreviewTextarea) sharePreviewTextarea.value = text;
    if (whatsappShareBtn) {
      whatsappShareBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    }
    if (shareModal) shareModal.classList.remove('hidden');
  }

  function generateShareSummaryText() {
    const from = state.selectedFrom || 'Dhaka';
    const to = state.selectedTo || 'Chattogram';
    const date = formatShohozDoj(state.selectedDate || new Date().toISOString().split('T')[0]);
    const trains = state.lastSearchData?.trains || [];

    let summary = `🚆 *RailSeat Finder BD — Train Seat Availability*\n📍 *Route:* ${from} ➔ ${to}\n📅 *Date:* ${date}\n\n`;

    const availTrains = trains.filter(t => (t.total_combined_seats || 0) > 0);
    if (availTrains.length === 0) {
      summary += `🔴 All trains are currently SOLD OUT on this date.\n`;
    } else {
      availTrains.forEach(t => {
        summary += `🟢 *${t.train_name} (#${t.train_model})* — Dep: ${t.departure_time}\n`;
        (t.seat_types || []).forEach(st => {
          const count = Number(st.seats_available || 0) + Number(st.counter_seats_available || 0);
          if (count > 0) {
            summary += `   • ${st.display_name}: ${count} seats available (৳${st.total_fare})\n`;
          }
        });
        summary += `\n`;
      });
    }

    summary += `🔗 *Book online:* https://eticket.railway.gov.bd\n✨ Checked real-time via RailSeat Finder BD`;
    return summary;
  }

  // ----------------------------------------------------
  // Single-Day All-Station Blank Seat Matrix Module (Multi-Select Supported)
  // ----------------------------------------------------
  let currentStationMatrixTarget = {
    trainModel: '',
    trainName: '',
    date: '',
    selectedFroms: new Set(),
    selectedTos: new Set(),
    stoppages: []
  };

  function initStationMatrixModule() {
    if (stationMatrixCloseBtn && stationMatrixModal) {
      stationMatrixCloseBtn.addEventListener('click', () => {
        stationMatrixModal.classList.add('hidden');
        closeStationDropdowns();
      });
    }

    if (stationMatrixModal) {
      stationMatrixModal.addEventListener('click', (e) => {
        if (e.target === stationMatrixModal) {
          stationMatrixModal.classList.add('hidden');
          closeStationDropdowns();
        }
      });
    }

    // Dropdown toggles
    if (matrixFromDropdownBtn) {
      matrixFromDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = matrixFromDropdownMenu.classList.contains('hidden');
        closeStationDropdowns();
        if (isHidden) {
          matrixFromDropdownMenu.classList.remove('hidden');
          if (matrixFromDropdownArrow) matrixFromDropdownArrow.classList.add('rotate-180');
        }
      });
    }

    if (matrixToDropdownBtn) {
      matrixToDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = matrixToDropdownMenu.classList.contains('hidden');
        closeStationDropdowns();
        if (isHidden) {
          matrixToDropdownMenu.classList.remove('hidden');
          if (matrixToDropdownArrow) matrixToDropdownArrow.classList.add('rotate-180');
        }
      });
    }

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (matrixFromDropdownMenu && !matrixFromDropdownMenu.contains(e.target) && e.target !== matrixFromDropdownBtn && !matrixFromDropdownBtn.contains(e.target)) {
        matrixFromDropdownMenu.classList.add('hidden');
        if (matrixFromDropdownArrow) matrixFromDropdownArrow.classList.remove('rotate-180');
      }
      if (matrixToDropdownMenu && !matrixToDropdownMenu.contains(e.target) && e.target !== matrixToDropdownBtn && !matrixToDropdownBtn.contains(e.target)) {
        matrixToDropdownMenu.classList.add('hidden');
        if (matrixToDropdownArrow) matrixToDropdownArrow.classList.remove('rotate-180');
      }
    });

    if (matrixFromSelectAllBtn) {
      matrixFromSelectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stoppages = currentStationMatrixTarget.stoppages || [];
        currentStationMatrixTarget.selectedFroms = new Set(stoppages.slice(0, -1).map(s => s.cleanCity));
        updateDownstreamDestinations();
        renderStationDropdowns();
      });
    }

    if (matrixFromClearBtn) {
      matrixFromClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stoppages = currentStationMatrixTarget.stoppages || [];
        if (stoppages.length > 0) {
          currentStationMatrixTarget.selectedFroms = new Set([stoppages[0].cleanCity]);
          updateDownstreamDestinations();
          renderStationDropdowns();
        }
      });
    }

    if (matrixToSelectAllBtn) {
      matrixToSelectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stoppages = currentStationMatrixTarget.stoppages || [];
        let minFromIdx = stoppages.length;
        stoppages.forEach((s, idx) => {
          if (currentStationMatrixTarget.selectedFroms.has(s.cleanCity) && idx < minFromIdx) {
            minFromIdx = idx;
          }
        });
        currentStationMatrixTarget.selectedTos = new Set(stoppages.slice(minFromIdx + 1).map(s => s.cleanCity));
        renderStationDropdowns();
      });
    }

    if (matrixToClearBtn) {
      matrixToClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stoppages = currentStationMatrixTarget.stoppages || [];
        if (stoppages.length > 0) {
          currentStationMatrixTarget.selectedTos = new Set([stoppages[stoppages.length - 1].cleanCity]);
          renderStationDropdowns();
        }
      });
    }

    if (matrixJourneyDateInput) {
      matrixJourneyDateInput.addEventListener('change', (e) => {
        currentStationMatrixTarget.date = e.target.value;
        updateMatrixSummary();
      });
    }

    if (matrixExecuteQueryBtn) {
      matrixExecuteQueryBtn.addEventListener('click', () => {
        closeStationDropdowns();
        fetchAndRenderStationMatrix();
      });
    }

    if (matrixSelectAllPairsBtn) {
      matrixSelectAllPairsBtn.addEventListener('click', () => {
        const stoppages = currentStationMatrixTarget.stoppages || [];
        if (stoppages.length === 0) return;
        currentStationMatrixTarget.selectedFroms = new Set(stoppages.slice(0, -1).map(s => s.cleanCity));
        currentStationMatrixTarget.selectedTos = new Set(stoppages.slice(1).map(s => s.cleanCity));
        renderStationDropdowns();
      });
    }

    if (matrixResetPairsBtn) {
      matrixResetPairsBtn.addEventListener('click', () => {
        const stoppages = currentStationMatrixTarget.stoppages || [];
        if (stoppages.length === 0) return;
        const defaultFrom = stoppages[0].cleanCity;
        currentStationMatrixTarget.selectedFroms = new Set([defaultFrom]);
        const validDests = stoppages.slice(1).map(s => s.cleanCity);
        currentStationMatrixTarget.selectedTos = new Set(validDests);
        renderStationDropdowns();
      });
    }

    if (routeModalLaunchMatrixBtn) {
      routeModalLaunchMatrixBtn.addEventListener('click', () => {
        const cleanModel = String(routeModalTrainModel.textContent).replace(/\D/g, '');
        const trainName = routeModalTrainName.textContent || '';
        openStationMatrixModal(cleanModel, trainName);
      });
    }
  }

  function closeStationDropdowns() {
    if (matrixFromDropdownMenu) matrixFromDropdownMenu.classList.add('hidden');
    if (matrixFromDropdownArrow) matrixFromDropdownArrow.classList.remove('rotate-180');
    if (matrixToDropdownMenu) matrixToDropdownMenu.classList.add('hidden');
    if (matrixToDropdownArrow) matrixToDropdownArrow.classList.remove('rotate-180');
  }

  function calculateValidPairsCount() {
    const stoppages = currentStationMatrixTarget.stoppages || [];
    let count = 0;
    for (let i = 0; i < stoppages.length - 1; i++) {
      const fromStop = stoppages[i];
      if (!currentStationMatrixTarget.selectedFroms.has(fromStop.cleanCity)) continue;
      for (let j = i + 1; j < stoppages.length; j++) {
        const toStop = stoppages[j];
        if (currentStationMatrixTarget.selectedTos.has(toStop.cleanCity)) {
          count++;
        }
      }
    }
    return count;
  }

  function updateMatrixSummary() {
    const fromCount = currentStationMatrixTarget.selectedFroms.size;
    const toCount = currentStationMatrixTarget.selectedTos.size;
    const pairsCount = calculateValidPairsCount();

    if (matrixFromCountBadge) {
      matrixFromCountBadge.textContent = `${fromCount} selected`;
    }
    if (matrixToCountBadge) {
      matrixToCountBadge.textContent = `${toCount} selected`;
    }
    if (matrixPairsSummaryText) {
      matrixPairsSummaryText.textContent = `${fromCount} Boarding × ${toCount} Destination (${pairsCount} pair${pairsCount === 1 ? '' : 's'} to search)`;
    }
    if (matrixExecuteQueryBtnText) {
      matrixExecuteQueryBtnText.textContent = `Search (${pairsCount})`;
    }

    // Update Dropdown Labels
    const fromArray = Array.from(currentStationMatrixTarget.selectedFroms);
    if (matrixFromDropdownLabel) {
      if (fromArray.length === 0) {
        matrixFromDropdownLabel.textContent = 'Select Boarding Station...';
      } else if (fromArray.length === 1) {
        matrixFromDropdownLabel.textContent = `${fromArray[0]}`;
      } else if (fromArray.length === (currentStationMatrixTarget.stoppages.length - 1)) {
        matrixFromDropdownLabel.textContent = `All Boarding Stops (${fromArray.length})`;
      } else if (fromArray.length === 2) {
        matrixFromDropdownLabel.textContent = `${fromArray[0]}, ${fromArray[1]}`;
      } else {
        matrixFromDropdownLabel.textContent = `${fromArray[0]} + ${fromArray.length - 1} more`;
      }
    }

    const toArray = Array.from(currentStationMatrixTarget.selectedTos);
    if (matrixToDropdownLabel) {
      if (toArray.length === 0) {
        matrixToDropdownLabel.textContent = 'Select Destination...';
      } else if (toArray.length === 1) {
        matrixToDropdownLabel.textContent = `${toArray[0]}`;
      } else if (toArray.length > 2 && toArray.length === (currentStationMatrixTarget.stoppages.length - 1)) {
        matrixToDropdownLabel.textContent = `All Downstream Stops (${toArray.length})`;
      } else if (toArray.length === 2) {
        matrixToDropdownLabel.textContent = `${toArray[0]}, ${toArray[1]}`;
      } else {
        matrixToDropdownLabel.textContent = `${toArray[0]} + ${toArray.length - 1} more`;
      }
    }
  }

  function renderStationDropdowns() {
    const stoppages = currentStationMatrixTarget.stoppages || [];
    if (stoppages.length === 0) return;

    // 1. Render From Dropdown Options
    if (matrixFromOptionsContainer) {
      const fromStops = stoppages.slice(0, -1);
      matrixFromOptionsContainer.innerHTML = fromStops.map((s, idx) => {
        const isSelected = currentStationMatrixTarget.selectedFroms.has(s.cleanCity);
        const isOrigin = idx === 0;

        return `
          <label class="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-slate-800 cursor-pointer transition select-none ${isSelected ? 'bg-emerald-50/70 dark:bg-slate-800/80 font-bold' : ''}">
            <input type="checkbox" class="matrix-from-checkbox rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer w-3.5 h-3.5" data-city="${s.cleanCity}" ${isSelected ? 'checked' : ''}>
            <span class="text-xs text-slate-800 dark:text-slate-200 flex-1 truncate">${s.cleanCity} ${isOrigin ? '<span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">(Origin)</span>' : ''}</span>
            <span class="text-[10px] text-slate-400 font-mono shrink-0">${s.departure_time}</span>
          </label>
        `;
      }).join('');

      matrixFromOptionsContainer.querySelectorAll('.matrix-from-checkbox').forEach(chk => {
        chk.addEventListener('change', (e) => {
          e.stopPropagation();
          const city = chk.dataset.city;
          if (chk.checked) {
            currentStationMatrixTarget.selectedFroms.add(city);
          } else {
            if (currentStationMatrixTarget.selectedFroms.size > 1) {
              currentStationMatrixTarget.selectedFroms.delete(city);
            } else {
              chk.checked = true;
              showToast('At least 1 Boarding Station must be selected.', 'info');
              return;
            }
          }
          updateDownstreamDestinations();
          renderStationDropdowns();
        });
      });
    }

    // 2. Render To Dropdown Options
    if (matrixToOptionsContainer) {
      let minFromIdx = stoppages.length;
      stoppages.forEach((s, idx) => {
        if (currentStationMatrixTarget.selectedFroms.has(s.cleanCity) && idx < minFromIdx) {
          minFromIdx = idx;
        }
      });

      const validDests = stoppages.slice(minFromIdx + 1);

      matrixToOptionsContainer.innerHTML = validDests.map((s, idx) => {
        const isSelected = currentStationMatrixTarget.selectedTos.has(s.cleanCity);
        const isTerminus = idx === validDests.length - 1;

        return `
          <label class="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg hover:bg-teal-50 dark:hover:bg-slate-800 cursor-pointer transition select-none ${isSelected ? 'bg-teal-50/70 dark:bg-slate-800/80 font-bold' : ''}">
            <input type="checkbox" class="matrix-to-checkbox rounded text-teal-600 focus:ring-teal-500 cursor-pointer w-3.5 h-3.5" data-city="${s.cleanCity}" ${isSelected ? 'checked' : ''}>
            <span class="text-xs text-slate-800 dark:text-slate-200 flex-1 truncate">${s.cleanCity} ${isTerminus ? '<span class="text-[10px] text-teal-600 dark:text-teal-400 font-normal">(Terminus)</span>' : ''}</span>
            <span class="text-[10px] text-slate-400 font-mono shrink-0">${s.arrival_time}</span>
          </label>
        `;
      }).join('');

      matrixToOptionsContainer.querySelectorAll('.matrix-to-checkbox').forEach(chk => {
        chk.addEventListener('change', (e) => {
          e.stopPropagation();
          const city = chk.dataset.city;
          if (chk.checked) {
            currentStationMatrixTarget.selectedTos.add(city);
          } else {
            if (currentStationMatrixTarget.selectedTos.size > 1) {
              currentStationMatrixTarget.selectedTos.delete(city);
            } else {
              chk.checked = true;
              showToast('At least 1 Destination Station must be selected.', 'info');
              return;
            }
          }
          renderStationDropdowns();
        });
      });
    }

    updateMatrixSummary();
  }

  function updateDownstreamDestinations() {
    const stoppages = currentStationMatrixTarget.stoppages || [];
    let minFromIdx = stoppages.length;
    stoppages.forEach((s, idx) => {
      if (currentStationMatrixTarget.selectedFroms.has(s.cleanCity) && idx < minFromIdx) {
        minFromIdx = idx;
      }
    });

    const validDests = new Set(stoppages.slice(minFromIdx + 1).map(s => s.cleanCity));
    const filteredTos = new Set([...currentStationMatrixTarget.selectedTos].filter(c => validDests.has(c)));
    if (filteredTos.size === 0 && validDests.size > 0) {
      currentStationMatrixTarget.selectedTos = validDests;
    } else {
      currentStationMatrixTarget.selectedTos = filteredTos;
    }
  }

  async function openStationMatrixModal(trainModel, trainName = '', initialDate = '', initialFrom = '', initialTo = '') {
    if (!trainModel) return;
    const cleanModel = String(trainModel).replace(/\D/g, '') || String(trainModel).trim();
    const doj = initialDate || state.selectedDate || new Date().toISOString().split('T')[0];

    currentStationMatrixTarget.trainModel = cleanModel;
    currentStationMatrixTarget.trainName = trainName || `Train #${cleanModel}`;
    currentStationMatrixTarget.date = doj;

    if (stationMatrixTrainName) stationMatrixTrainName.textContent = trainName || `Train #${cleanModel}`;
    if (stationMatrixTrainModel) stationMatrixTrainModel.textContent = `#${cleanModel}`;
    if (matrixJourneyDateInput) matrixJourneyDateInput.value = doj;
    if (stationMatrixSubtitle) stationMatrixSubtitle.textContent = 'Loading train stoppage stations...';

    if (stationMatrixModal) stationMatrixModal.classList.remove('hidden');

    if (stationMatrixContent) {
      stationMatrixContent.innerHTML = `
        <div class="py-12 text-center text-slate-400 space-y-3">
          <i class="fa-solid fa-spinner fa-spin text-3xl text-emerald-500"></i>
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">Loading stoppage route for #${cleanModel}...</p>
        </div>
      `;
    }

    try {
      const token = getAuthToken();
      const routeRes = await fetch(`/api/train-route?model=${encodeURIComponent(cleanModel)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const routeJson = await routeRes.json();

      if (!routeJson.success || !routeJson.data?.routes || routeJson.data.routes.length === 0) {
        if (stationMatrixContent) {
          stationMatrixContent.innerHTML = `
            <div class="py-8 text-center text-slate-400 space-y-2">
              <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-500"></i>
              <p class="text-xs font-bold text-slate-700 dark:text-slate-200">Stoppage Route Not Available</p>
              <p class="text-[11px] text-slate-400">Could not retrieve stoppage stations for train #${cleanModel}.</p>
            </div>
          `;
        }
        return;
      }

      const stoppages = (routeJson.data.routes || []).map(s => ({
        city: s.city,
        cleanCity: (s.city || '').replace(/_/g, ' ').trim(),
        arrival_time: s.arrival_time || '--',
        departure_time: s.departure_time || '--'
      }));

      currentStationMatrixTarget.stoppages = stoppages;
      if (stationMatrixSubtitle) {
        stationMatrixSubtitle.textContent = `${formatShohozDoj(doj)} • Off-Day: ${routeJson.data.off_day || 'None'} • ${stoppages.length} Total Stoppages`;
      }

      // Default selected From: state.selectedFrom or initialFrom if on route, else stoppages[0]
      const preferredFrom = (initialFrom || state.selectedFrom || '').toLowerCase().trim();
      const matchFrom = stoppages.slice(0, -1).find(s => 
        s.cleanCity.toLowerCase() === preferredFrom || s.city.toLowerCase() === preferredFrom
      );

      const chosenFrom = matchFrom ? matchFrom.cleanCity : stoppages[0].cleanCity;
      currentStationMatrixTarget.selectedFroms = new Set([chosenFrom]);

      // Default selected To: state.selectedTo if downstream, else all reachable downstream stops
      const fromIdx = stoppages.findIndex(s => s.cleanCity === chosenFrom);
      const downstreamStops = stoppages.slice(fromIdx + 1).map(s => s.cleanCity);

      if (initialTo) {
        const preferredTo = initialTo.toLowerCase().trim();
        const matchTo = downstreamStops.find(c => c.toLowerCase() === preferredTo);
        currentStationMatrixTarget.selectedTos = matchTo ? new Set([matchTo]) : new Set(downstreamStops);
      } else {
        // Show all stoppage stations by default for the Stops Matrix
        currentStationMatrixTarget.selectedTos = new Set(downstreamStops);
      }

      renderStationDropdowns();

      // Do NOT auto-query live seats upon opening. Wait for user to click Search button.
      if (stationMatrixContent) {
        stationMatrixContent.innerHTML = `
          <div class="py-12 px-4 text-center space-y-3.5 animate-fade-in">
            <div class="w-12 h-12 mx-auto rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl shadow-xs">
              <i class="fa-solid fa-table-cells"></i>
            </div>
            <div class="space-y-1">
              <h4 class="font-extrabold text-sm text-slate-900 dark:text-white">Route Stoppages Loaded (${stoppages.length} Stations)</h4>
              <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Customize your Boarding & Destination stations above, then click <b>Search</b> to query real-time vacancy for each segment.
              </p>
            </div>
            <div class="pt-1">
              <button type="button" id="matrixInitialSearchBtn" class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold shadow-md shadow-emerald-600/25 inline-flex items-center space-x-2 transition cursor-pointer active:scale-95">
                <i class="fa-solid fa-magnifying-glass text-xs"></i>
                <span>Search Live Stoppage Seats</span>
              </button>
            </div>
          </div>
        `;

        const initialSearchBtn = document.getElementById('matrixInitialSearchBtn');
        if (initialSearchBtn) {
          initialSearchBtn.addEventListener('click', () => {
            closeStationDropdowns();
            fetchAndRenderStationMatrix();
          });
        }
      }

    } catch (e) {
      console.error('Error loading route in matrix:', e);
      if (stationMatrixContent) {
        stationMatrixContent.innerHTML = `
          <div class="py-8 text-center text-rose-500 space-y-2">
            <i class="fa-solid fa-circle-exclamation text-xl"></i>
            <p class="text-xs">Failed to load route stoppages.</p>
          </div>
        `;
      }
    }
  }

  async function fetchAndRenderStationMatrix() {
    if (!stationMatrixContent) return;

    if (currentStationMatrixTarget.selectedFroms.size === 0 || currentStationMatrixTarget.selectedTos.size === 0) {
      stationMatrixContent.innerHTML = `
        <div class="py-8 text-center text-slate-400 space-y-2">
          <i class="fa-solid fa-hand-pointer text-2xl text-emerald-500"></i>
          <p class="text-xs font-bold text-slate-700 dark:text-slate-200">Select Station(s) Above</p>
          <p class="text-[11px] text-slate-400">Click to select 1 or more Boarding and Destination stations.</p>
        </div>
      `;
      return;
    }

    const fromListParam = Array.from(currentStationMatrixTarget.selectedFroms).join(',');
    const toListParam = Array.from(currentStationMatrixTarget.selectedTos).join(',');

    const fromCount = currentStationMatrixTarget.selectedFroms.size;
    const toCount = currentStationMatrixTarget.selectedTos.size;

    if (matrixExecuteQueryBtn) {
      matrixExecuteQueryBtn.disabled = true;
      matrixExecuteQueryBtn.classList.add('opacity-70');
    }
    if (matrixExecuteQueryBtnText) {
      matrixExecuteQueryBtnText.textContent = 'Searching...';
    }

    stationMatrixContent.innerHTML = `
      <div class="py-10 text-center text-slate-400 space-y-3">
        <i class="fa-solid fa-spinner fa-spin text-3xl text-emerald-500"></i>
        <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">Querying live seats for ${fromCount} Boarding ➔ ${toCount} Destination stop(s)...</p>
        <p class="text-[11px] text-slate-400">Checking vacancies on #${currentStationMatrixTarget.trainModel} (${formatShohozDoj(currentStationMatrixTarget.date)})</p>
      </div>
    `;

    try {
      const token = getAuthToken();
      const url = `/api/train-station-matrix?model=${encodeURIComponent(currentStationMatrixTarget.trainModel)}&date_of_journey=${encodeURIComponent(currentStationMatrixTarget.date)}&from_station=${encodeURIComponent(fromListParam)}&to_station=${encodeURIComponent(toListParam)}`;
      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();

      if (!data.success) {
        stationMatrixContent.innerHTML = `
          <div class="py-8 text-center text-slate-400 space-y-2">
            <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-500"></i>
            <p class="text-xs font-bold text-slate-700 dark:text-slate-200">Unable to load Station Seat Matrix</p>
            <p class="text-[11px] text-slate-400">${data.error || 'Please ensure your live API session is connected.'}</p>
          </div>
        `;
        return;
      }

      renderStationMatrixResults(data);

    } catch (err) {
      console.warn('Station matrix fetch error:', err);
      stationMatrixContent.innerHTML = `
        <div class="py-8 text-center text-rose-500 space-y-2">
          <i class="fa-solid fa-circle-exclamation text-xl"></i>
          <p class="text-xs">Failed to fetch station matrix. Please try again.</p>
        </div>
      `;
    } finally {
      if (matrixExecuteQueryBtn) {
        matrixExecuteQueryBtn.disabled = false;
        matrixExecuteQueryBtn.classList.remove('opacity-70');
      }
      updateMatrixSummary();
    }
  }

  function renderStationMatrixResults(data) {
    const segments = data.segments || [];

    if (segments.length === 0) {
      stationMatrixContent.innerHTML = `
        <div class="py-8 text-center text-slate-400 space-y-2">
          <p class="text-xs font-bold text-slate-700 dark:text-slate-200">No Station Pairs Found</p>
          <p class="text-[11px] text-slate-400">Please choose another boarding station or journey date.</p>
        </div>
      `;
      return;
    }

    // Group segments by Boarding Station
    const grouped = new Map();
    segments.forEach(seg => {
      if (!grouped.has(seg.from)) {
        grouped.set(seg.from, []);
      }
      grouped.get(seg.from).push(seg);
    });

    let html = `
      <!-- Summary Banner -->
      <div class="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 border-2 border-emerald-300 dark:border-emerald-700 flex items-center justify-between gap-2 text-xs">
        <div class="flex items-center space-x-2">
          <div class="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shadow-xs">
            <i class="fa-solid fa-table-cells"></i>
          </div>
          <div>
            <span class="font-black text-slate-900 dark:text-white text-xs sm:text-sm">${data.train_name} (#${data.train_model})</span>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">${data.display_date} &bull; ${segments.filter(s => s.has_seats).length} segment(s) with vacant seats</p>
          </div>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-extrabold">Total Stops</span>
          <p class="font-black text-emerald-700 dark:text-emerald-300 text-base">${(data.stoppages || []).length}</p>
        </div>
      </div>
    `;

    grouped.forEach((segList, boardingCity) => {
      html += `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border-2 border-slate-300 dark:border-slate-700 p-4 shadow-xs space-y-3">
          <!-- Boarding City Header -->
          <div class="flex items-center justify-between pb-2.5 border-b-2 border-slate-100 dark:border-slate-800">
            <div class="flex items-center space-x-2">
              <span class="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-xs font-bold">
                <i class="fa-solid fa-location-dot text-xs"></i>
              </span>
              <div>
                <h4 class="text-xs sm:text-sm font-black text-slate-900 dark:text-white">From ${boardingCity}</h4>
                <span class="text-[10px] text-slate-400">Departure: ${segList[0]?.departure_time || '--'}</span>
              </div>
            </div>
            <span class="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
              ${segList.length} Destinations
            </span>
          </div>

          <!-- Destinations Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            ${segList.map(seg => {
              const isAvail = seg.has_seats;
              const totalSeats = seg.total_seats || 0;

              return `
                <div class="p-3 rounded-xl border-2 ${
                  isAvail 
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-700 shadow-2xs' 
                    : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                } flex flex-col justify-between space-y-2.5 transition hover:shadow-xs">
                  
                  <!-- Top: Destination & Seat Count Badge -->
                  <div class="flex items-center justify-between gap-1">
                    <div class="min-w-0">
                      <div class="flex items-center space-x-1.5 truncate">
                        <i class="fa-solid fa-arrow-right text-emerald-500 text-[10px]"></i>
                        <span class="font-extrabold text-xs text-slate-900 dark:text-white truncate">${seg.to}</span>
                      </div>
                      <div class="text-[10px] text-slate-400 mt-0.5">
                        Arr: ${seg.arrival_time} ${seg.travel_time ? `&bull; ${seg.travel_time}` : ''}
                      </div>
                    </div>

                    <span class="px-2 py-0.5 rounded-lg text-[11px] font-extrabold shadow-2xs shrink-0 ${
                      isAvail 
                        ? (totalSeats > 10 ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white') 
                        : 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                    }">
                      ${isAvail ? `🟢 ${totalSeats} Seats` : '🔴 Sold Out'}
                    </span>
                  </div>

                  <!-- Classes Breakdown & Price -->
                  ${isAvail && seg.seat_types && seg.seat_types.length > 0 ? `
                    <div class="flex flex-wrap gap-1 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                      ${seg.seat_types.filter(st => (Number(st.seats_available||0)+Number(st.counter_seats_available||0)) > 0).map(st => {
                        const cnt = Number(st.seats_available||0)+Number(st.counter_seats_available||0);
                        const baseFare = Number(st.fare || 0);
                        const vat = Number(st.vat || 0);
                        const totalFare = Number(st.total_fare !== undefined ? st.total_fare : (baseFare + vat));

                        return `
                          <span class="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-100/80 dark:bg-emerald-950 text-[10px] font-bold text-emerald-900 dark:text-emerald-200">
                            <span>${st.display_name || st.type}:</span>
                            <span class="font-extrabold">${cnt}</span>
                            <span class="text-emerald-700 dark:text-emerald-300">(৳${totalFare})</span>
                          </span>
                        `;
                      }).join('')}
                    </div>
                  ` : ''}

                  <!-- Action: Direct Book Link -->
                  <div class="pt-1 flex items-center justify-end">
                    <a href="${seg.book_url}" target="_blank" rel="noopener" 
                      class="px-2.5 py-1 rounded-lg text-xs font-bold transition inline-flex items-center space-x-1 ${
                        isAvail 
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs' 
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      }">
                      <span>Book ${seg.from} ➔ ${seg.to}</span>
                      <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                    </a>
                  </div>

                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    stationMatrixContent.innerHTML = html;
  }

  // ----------------------------------------------------
  // 💺 Live Coach & Seat Details Layout Module
  // ----------------------------------------------------
  let currentSeatLayoutState = {
    trainModel: '',
    trainName: '',
    tripId: '',
    tripRouteId: '',
    fromCity: '',
    toCity: '',
    journeyDate: '',
    coaches: [],
    activeCoachIndex: 0,
    selectedSeat: null,
    isLive: false,
    fetching: false,
    requiresTurnstile: false,
    notice: ''
  };

  // The official Railway seat-layout endpoint is gated behind a Cloudflare
  // Turnstile token. When the user pairs a session by pasting the raw curl from
  // eticket.railway.gov.bd, their token is stored alongside it. Surface it here
  // so the live per-seat map request can be authorised.
  function getStoredCftResponse() {
    try {
      const stores = [
        (typeof localStorage !== 'undefined') ? localStorage : null,
        (typeof sessionStorage !== 'undefined') ? sessionStorage : null
      ].filter(Boolean);
      const keys = ['railway_cft_response', 'cft_response', 'cftResponse', 'cf-turnstile-response', 'rail_cft_response'];
      for (const store of stores) {
        for (const key of keys) {
          const val = store.getItem(key);
          if (val && String(val).trim()) return String(val).trim();
        }
      }
    } catch (e) { /* storage unavailable */ }
    return '';
  }

  // ----------------------------------------------------
  // Automatic Background Turnstile Token Collector
  // Loads a hidden iframe pointing to Bangladesh Railway search or registration
  // where the userscript runs, immediately capturing fresh Turnstile tokens
  // and sending them to /api/auth/set-token to keep live layouts 100% active.
  // ----------------------------------------------------
  // ----------------------------------------------------
  // Automatic Background Turnstile Token Collector Bridge
  // 100% Invisible Background Execution (Zero popups, zero tabs, zero screen intrusion)
  // Keeps fresh tokens alive via userscript sync and server solver.
  // ----------------------------------------------------
  let _lastCftRequestTime = 0;
  let _isRefreshingTurnstile = false;

  async function requestBackgroundTurnstileToken(force = false) {
    const now = Date.now();
    if (!force && now - _lastCftRequestTime < 4000) return;
    _lastCftRequestTime = now;

    if (_isRefreshingTurnstile) return;
    _isRefreshingTurnstile = true;

    try {
      const res = await fetch('/api/auth/refresh-turnstile' + (force ? '?force=1' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.token) {
          const token = json.token;
          console.log('[Turnstile Solver] ⚡ Background token refreshed:', token.substring(0, 15) + '...');
          window._freshBridgeCft = token;
          try {
            localStorage.setItem('railway_cft_response', token);
            localStorage.setItem('cft_response', token);
          } catch (e) {}

          // If seat layout modal is open and showing non-live (template), auto-reload it with live data
          if (currentSeatLayoutState && seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
            if (!currentSeatLayoutState.isLive) {
              console.log('[Turnstile Solver] Auto-reloading live seat layout with fresh background token...');
              fetchClassLiveSeatLayout(currentSeatLayoutState.lastFetchedClass || 'S_CHAIR');
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Turnstile Solver] Background refresh error:', e.message);
    } finally {
      _isRefreshingTurnstile = false;
    }
  }

  // ----------------------------------------------------
  // Proactive Background Turnstile Token Keeper (Dashboard)
  // Keeps a fresh token permanently alive in the background
  // so any train seat map loads instantly with zero wait.
  // ----------------------------------------------------
  function initBackgroundTurnstileKeeper() {
    async function keepTokenWarm() {
      try {
        const res = await fetch('/api/auth/token-status');
        if (res.ok) {
          const data = await res.json();
          // If token is missing, expired, or older than 90 seconds, request refresh
          if (!data.has_cft || !data.cft_response || (data.cft_age_seconds && data.cft_age_seconds > 90)) {
            requestBackgroundTurnstileToken(false);
          }
        }
      } catch (e) {}
    }

    // Check every 60 seconds
    setInterval(keepTokenWarm, 60000);
    // When tab gains focus, check immediately
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        keepTokenWarm();
      }
    });
    // Check shortly after boot
    setTimeout(keepTokenWarm, 3000);
  }

  initBackgroundTurnstileKeeper();

  // Listen for direct postMessage token & seatLayout sync from userscript (if active on same domain or iframe)
  window.addEventListener('message', (ev) => {
    try {
      if (ev.data && (ev.data.type === 'RAILSEAT_CFT_TOKEN' || ev.data.type === 'RAILSEAT_LIVE_LAYOUT')) {
        if (ev.data.cft_response) {
          const token = ev.data.cft_response;
          console.log('[Turnstile Bridge] ⚡ Received fresh token via postMessage:', token.substring(0, 15));
          window._freshBridgeCft = token;
          try {
            localStorage.setItem('railway_cft_response', token);
            localStorage.setItem('cft_response', token);
          } catch (e) {}

          // Broadcast to server immediately to keep server vault primed
          try {
            fetch('/api/auth/set-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cft_response: token })
            });
          } catch (e) {}
        }

        // Direct Raw Shohoz layout payload push
        if (ev.data.layout && currentSeatLayoutState && seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
          const raw = ev.data.layout.data || ev.data.layout;
          const extracted = extractCoachesFromPayload(raw, currentSeatLayoutState.lastFetchedClass || 'S_CHAIR');
          if (extracted && extracted.length > 0) {
            console.log('[SeatLayout Direct-Sync] 🎯 Instant live layout received via postMessage!');
            currentSeatLayoutState.allCoaches = extracted;
            const availCoaches = extracted.filter(isCoachAvailable);
            currentSeatLayoutState.allSoldOut = (availCoaches.length === 0);
            currentSeatLayoutState.coaches = (currentSeatLayoutState.availableOnly && availCoaches.length > 0) ? availCoaches : extracted;
            currentSeatLayoutState.isLive = true;
            currentSeatLayoutState.fetching = false;
            renderSeatLayoutCoachTabs();
            renderActiveCoachCarriage();
            syncSeatLayoutSourceBadges();
            return;
          }
        }

        // If seat layout modal is currently open and waiting, immediately re-fetch live layout with fresh token
        if (currentSeatLayoutState && seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
          if (!currentSeatLayoutState.isLive) {
            console.log('[Turnstile Bridge] Fast-updating live seat layout with fresh Turnstile token...');
            fetchClassLiveSeatLayout(currentSeatLayoutState.lastFetchedClass || 'S_CHAIR');
          }
        }
      }
    } catch (e) {}
  });

  // Also listen for cross-tab localStorage storage events (when user or userscript collects token in another tab)
  window.addEventListener('storage', (ev) => {
    try {
      if ((ev.key === 'railway_cft_response' || ev.key === 'cft_response') && ev.newValue) {
        window._freshBridgeCft = ev.newValue;
        if (currentSeatLayoutState && seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
          if (!currentSeatLayoutState.isLive) {
            console.log('[Turnstile Bridge] Storage event: re-fetching live seat layout with newly detected token...');
            fetchClassLiveSeatLayout(currentSeatLayoutState.lastFetchedClass || 'S_CHAIR');
          }
        }
      }
    } catch (e) {}
  });

  // Background keep-alive loop: proactively refresh token every 2.5 minutes while page is active
  setInterval(() => {
    if (!document.hidden) {
      const hasStored = getStoredCftResponse();
      if (!hasStored || (currentSeatLayoutState && !currentSeatLayoutState.isLive)) {
        requestBackgroundTurnstileToken();
      }
    }
  }, 150000);

  // ----------------------------------------------------
  // Native Android In-App Background Automation Bridge
  // ----------------------------------------------------
  window.onNativeRailwayTokenReceived = function(cftToken, tripId, tripRouteId) {
    if (!cftToken) return;
    console.log('[NativeBridge] Received Turnstile token from Android WebView:', cftToken.substring(0, 15));
    try {
      localStorage.setItem('railway_cft_response', cftToken);
      localStorage.setItem('cft_response', cftToken);
    } catch (e) {}

    if (currentSeatLayoutState && seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
      if (tripId && !tripId.startsWith('TRIP_')) currentSeatLayoutState.tripId = tripId;
      if (tripRouteId && !tripRouteId.startsWith('ROUTE_')) currentSeatLayoutState.tripRouteId = tripRouteId;

      showToast(window.i18n?.getLang() === 'bn' ? '⚡ অ্যান্ড্রয়েড ব্যাকগ্রাউন্ড থেকে লাইভ টোকেন পাওয়া গেছে! সিট লোড হচ্ছে...' : '⚡ Live token captured automatically by Android! Loading live seats...', 'success');

      openSeatLayoutModal({
        trainModel: currentSeatLayoutState.trainModel,
        trainName: currentSeatLayoutState.trainName,
        departureTime: currentSeatLayoutState.departureTime,
        tripId: currentSeatLayoutState.tripId,
        tripRouteId: currentSeatLayoutState.tripRouteId,
        seatClass: currentSeatLayoutState.lastFetchedClass,
        fromCity: currentSeatLayoutState.fromCity,
        toCity: currentSeatLayoutState.toCity,
        journeyDate: currentSeatLayoutState.journeyDate
      });
    }
  };

  // ----------------------------------------------------
  // Real-Time Railway WebSocket Client Module
  // ----------------------------------------------------
  const RAIL_SOCKET_URL = 'wss://train-websocket.shohoz.com/socket.io/?EIO=4&transport=websocket';
  let activeSeatLayoutWebSocket = null;
  let activeSeatLayoutRoomName = null;

  function formatCanonicalShohozDate(inputDate) {
    if (!inputDate) return '';
    const clean = String(inputDate).trim();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(clean)) return clean;
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(clean)) {
      const parts = clean.split('-');
      const y = parts[0];
      const m = parseInt(parts[1], 10) - 1;
      const d = String(parseInt(parts[2], 10)).padStart(2, '0');
      if (m >= 0 && m < 12) return `${d}-${months[m]}-${y}`;
    }
    const dt = new Date(clean);
    if (!isNaN(dt.getTime())) {
      const d = String(dt.getDate()).padStart(2, '0');
      const m = months[dt.getMonth()];
      const y = dt.getFullYear();
      return `${d}-${m}-${y}`;
    }
    return clean;
  }

  function buildClientTripRoomName(model, from, to, date) {
    const m = String(model || '').replace(/\D/g, '') || String(model || '').trim();
    const normalizeStation = (s) => {
      const clean = String(s || '').trim().replace(/_/g, ' ');
      const lower = clean.toLowerCase();
      if (typeof CITY_ALIASES !== 'undefined' && CITY_ALIASES[lower]) return CITY_ALIASES[lower];
      if (lower === 'chittagong' || lower === 'ctg') return 'Chattogram';
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    };
    const f = normalizeStation(from);
    const t = normalizeStation(to);
    const d = formatCanonicalShohozDate(date);
    return `LIVE#train#${m}#${f}#${t}#${d}`;
  }

  let seatSocketReconnectTimer = null;
  let lastSocketReleaseToastTime = 0;

  function connectSeatLayoutWebSocket(roomName, model) {
    if (activeSeatLayoutWebSocket && activeSeatLayoutRoomName === roomName && activeSeatLayoutWebSocket.readyState === WebSocket.OPEN) {
      return;
    }
    disconnectSeatLayoutWebSocket();
    if (!roomName) return;

    activeSeatLayoutRoomName = roomName;
    const socketBadge = document.getElementById('seatLayoutSocketBadge');
    const socketBadgeText = document.getElementById('seatLayoutSocketBadgeText');
    const isBn = window.i18n && window.i18n.getLang() === 'bn';

    try {
      const ws = new WebSocket(RAIL_SOCKET_URL);
      activeSeatLayoutWebSocket = ws;

      ws.onopen = () => {
        console.log('[SeatSocket] 🟢 Connected to Railway WebSocket:', RAIL_SOCKET_URL);
      };

      ws.onmessage = (event) => {
        const raw = String(event.data || '');

        // Engine.IO open handshake (0{...}) -> reply 40 and announce room
        if (raw.charAt(0) === '0') {
          try { ws.send('40'); } catch (e) {}
          try {
            ws.send('42' + JSON.stringify(['seatLayoutOpened', { roomName, model: model || null }]));
            console.log('[SeatSocket] 📡 Announced room subscription:', roomName);
          } catch (e) {}
          if (socketBadge) {
            socketBadge.classList.remove('hidden');
            socketBadge.classList.add('inline-flex');
            if (socketBadgeText) {
              socketBadgeText.textContent = isBn ? 'লাইভ স্ট্রিম' : 'Live Stream';
            }
          }
          return;
        }

        // Engine.IO Ping (2) -> Pong (3) heartbeat
        if (raw.charAt(0) === '2') {
          try { ws.send('3'); } catch (e) {}
          return;
        }

        // Socket.IO message (42["inProgressTickets", ...])
        if (raw.startsWith('42')) {
          let parsed;
          try { parsed = JSON.parse(raw.slice(2)); } catch (e) { return; }
          if (!Array.isArray(parsed) || parsed[0] !== 'inProgressTickets') return;
          const payload = parsed[1] || {};
          handleIncomingSeatSocketEvent(payload);
        }
      };

      ws.onerror = (err) => {
        console.warn('[SeatSocket] WebSocket notice:', err);
      };

      ws.onclose = () => {
        if (socketBadge) {
          socketBadge.classList.add('hidden');
          socketBadge.classList.remove('inline-flex');
        }
        // Auto-reconnect if seat modal is still actively open
        if (seatLayoutModal && !seatLayoutModal.classList.contains('hidden') && activeSeatLayoutRoomName === roomName) {
          if (seatSocketReconnectTimer) clearTimeout(seatSocketReconnectTimer);
          seatSocketReconnectTimer = setTimeout(() => {
            if (seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
              connectSeatLayoutWebSocket(roomName, model);
            }
          }, 3000);
        }
      };
    } catch (err) {
      console.warn('[SeatSocket] Failed to open WebSocket:', err);
    }
  }

  function disconnectSeatLayoutWebSocket() {
    if (seatSocketReconnectTimer) {
      clearTimeout(seatSocketReconnectTimer);
      seatSocketReconnectTimer = null;
    }
    if (activeSeatLayoutWebSocket) {
      try { activeSeatLayoutWebSocket.close(); } catch (e) {}
      activeSeatLayoutWebSocket = null;
    }
    activeSeatLayoutRoomName = null;
    const socketBadge = document.getElementById('seatLayoutSocketBadge');
    if (socketBadge) {
      socketBadge.classList.add('hidden');
      socketBadge.classList.remove('inline-flex');
    }
  }

  function handleIncomingSeatSocketEvent(payload) {
    if (!currentSeatLayoutState || !Array.isArray(currentSeatLayoutState.allCoaches) || currentSeatLayoutState.allCoaches.length === 0) {
      return;
    }
    const type = Number(payload.type); // 1 = held/in-progress, 2 = released
    const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
    if (!tickets.length) return;

    let stateChanged = false;
    let anySelectedLost = false;
    let heldSeatDisplay = null;
    let releasedSeatDisplay = null;

    const normalizeCoachStr = (name) => {
      if (!name) return '';
      return String(name).replace(/^(coach|bogie)[-_\s]*/i, '').trim().toUpperCase();
    };

    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const activeCoach = currentSeatLayoutState.coaches?.[currentSeatLayoutState.activeCoachIndex] || null;
    const activeCoachNorm = activeCoach ? normalizeCoachStr(activeCoach.coach_name) : null;

    tickets.forEach(t => {
      const tid = (t.ticket_id !== undefined && t.ticket_id !== null) ? String(t.ticket_id) : null;
      const rawSeatNum = t.seat_number ? String(t.seat_number).trim() : null;
      const sNumClean = rawSeatNum ? rawSeatNum.replace(/^[^-]+-/, '') : null;
      const incomingCoach = t.coach_name ? normalizeCoachStr(t.coach_name) : null;

      currentSeatLayoutState.allCoaches.forEach(coach => {
        const coachNorm = normalizeCoachStr(coach.coach_name);
        if (incomingCoach && coachNorm && coachNorm !== incomingCoach) {
          return;
        }

        const seatsToSearch = Array.isArray(coach.seats) ? coach.seats : [];

        seatsToSearch.forEach(s => {
          if (s.is_blank) return;
          const matchById = tid && s.ticket_id !== null && s.ticket_id !== undefined && String(s.ticket_id) === tid;
          const sSeatNum = String(s.seat_number || '').trim();
          const sDispNum = String(s.display_number || '').trim();
          const sCleanNum = sSeatNum.replace(/^[^-]+-/, '');

          const matchByNum = rawSeatNum && (
            sSeatNum.toUpperCase() === rawSeatNum.toUpperCase() ||
            sDispNum.toUpperCase() === rawSeatNum.toUpperCase() ||
            (sNumClean && (sSeatNum.toUpperCase() === sNumClean.toUpperCase() || sDispNum.toUpperCase() === sNumClean.toUpperCase() || sCleanNum.toUpperCase() === sNumClean.toUpperCase()))
          );

          if (matchById || (!tid && matchByNum)) {
            const fullSeatName = s.full_seat_name || s.seat_name || (coach.coach_name + '-' + s.seat_number);

            if (type === 1) {
              // Seat held by another user in 5-minute checkout
              if (s.status === 'available') {
                s.status = 'booking-in-process';
                coach.available_seats = Math.max(0, (coach.available_seats || 0) - 1);
                coach.in_process_seats = (coach.in_process_seats || 0) + 1;
                stateChanged = true;
                heldSeatDisplay = `${coach.coach_name}-${s.display_number || s.seat_number}`;

                // Deselect if currently picked by active user
                if (Array.isArray(currentSeatLayoutState.selectedSeats)) {
                  const selIdx = currentSeatLayoutState.selectedSeats.findIndex(sel =>
                    sel.seat_name === fullSeatName ||
                    sel.seat_name === s.seat_name ||
                    (normalizeCoachStr(sel.coach_name) === coachNorm && String(sel.seat_number) === String(s.seat_number))
                  );
                  if (selIdx !== -1) {
                    currentSeatLayoutState.selectedSeats.splice(selIdx, 1);
                    anySelectedLost = true;
                  }
                }

                // Instant DOM tile update if seat belongs to current active carriage
                if (seatLayoutContent && (!activeCoachNorm || coachNorm === activeCoachNorm)) {
                  const seatBtn = seatLayoutContent.querySelector(`button[data-seat-name="${fullSeatName}"], button[data-seat-number="${s.seat_number}"]`);
                  if (seatBtn) {
                    seatBtn.dataset.seatStatus = 'booking-in-process';
                    seatBtn.title = `${fullSeatName} (${isBn ? 'বুকিং চলমান' : 'In Process'} • ${isBn ? '৫ মিনিটের জন্য লক করা হয়েছে' : 'Locked in 5-min checkout'})`;
                    seatBtn.className = 'carriage-seat-btn aspect-square w-full rounded sm:rounded-md flex flex-col items-center justify-center p-0 transition duration-150 select-none bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-2 border-amber-500 dark:border-amber-400 cursor-not-allowed font-extrabold ring-2 ring-amber-300/60 dark:ring-amber-500/30 animate-pulse';

                    if (!seatBtn.querySelector('.fa-clock')) {
                      const clockBadge = document.createElement('span');
                      clockBadge.className = 'text-[8px] text-amber-600 dark:text-amber-400 font-black leading-none mt-0.5 animate-bounce';
                      clockBadge.innerHTML = '<i class="fa-regular fa-clock"></i>';
                      const numSpan = seatBtn.querySelector('.seat-number-text') || seatBtn.querySelector('span');
                      if (numSpan && numSpan.nextSibling) {
                        seatBtn.insertBefore(clockBadge, numSpan.nextSibling);
                      } else {
                        seatBtn.appendChild(clockBadge);
                      }
                    }
                  }
                }
              }
            } else if (type === 2) {
              // Seat released / hold expired -> reverts to Available
              if (s.status === 'booking-in-process') {
                s.status = 'available';
                coach.available_seats = (coach.available_seats || 0) + 1;
                coach.in_process_seats = Math.max(0, (coach.in_process_seats || 0) - 1);
                stateChanged = true;
                releasedSeatDisplay = `${coach.coach_name}-${s.display_number || s.seat_number}`;

                // Instant DOM tile update if seat belongs to current active carriage
                if (seatLayoutContent && (!activeCoachNorm || coachNorm === activeCoachNorm)) {
                  const seatBtn = seatLayoutContent.querySelector(`button[data-seat-name="${fullSeatName}"], button[data-seat-number="${s.seat_number}"]`);
                  if (seatBtn) {
                    seatBtn.dataset.seatStatus = 'available';
                    seatBtn.title = `${fullSeatName} (${isBn ? 'খালি' : 'Available'})`;
                    seatBtn.className = 'carriage-seat-btn aspect-square w-full rounded sm:rounded-md flex flex-col items-center justify-center p-0 transition duration-150 select-none bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-2 border-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 font-extrabold cursor-pointer shadow-2xs hover:scale-105';

                    const clockIcon = seatBtn.querySelector('.fa-clock');
                    if (clockIcon && clockIcon.parentElement) {
                      clockIcon.parentElement.remove();
                    }
                  }
                }
              }
            }
          }
        });

        // Also ensure coach.layout.rows reference statuses match
        if (coach.layout && Array.isArray(coach.layout.rows)) {
          coach.layout.rows.forEach(row => {
            if (!Array.isArray(row)) return;
            row.forEach(rowSeat => {
              if (!rowSeat || rowSeat.is_blank) return;
              const matchingFlatSeat = coach.seats.find(fs => fs.seat_name === rowSeat.seat_name || (fs.seat_number && fs.seat_number === rowSeat.seat_number));
              if (matchingFlatSeat) {
                rowSeat.status = matchingFlatSeat.status;
              }
            });
          });
        }
      });
    });

    if (anySelectedLost) {
      showToast(isBn ? '⚠️ আপনার নির্বাচিত একটি আসন অন্য একজন যাত্রী লক করেছেন।' : '⚠️ One of your selected seats was just reserved by another user.', 'warning');
      updateSeatLayoutBookNowButton();
    } else if (heldSeatDisplay && (Date.now() - lastSocketReleaseToastTime > 4000)) {
      lastSocketReleaseToastTime = Date.now();
      showToast(isBn ? `🔒 আসন হোল্ড: ${heldSeatDisplay} অন্য যাত্রী ৫ মিনিটের জন্য লক করেছেন!` : `🔒 Seat held: ${heldSeatDisplay} just locked by another passenger (5m checkout)!`, 'warning');
    } else if (releasedSeatDisplay && (Date.now() - lastSocketReleaseToastTime > 4000)) {
      lastSocketReleaseToastTime = Date.now();
      showToast(isBn ? `⚡ আসন অবমুক্ত হয়েছে: ${releasedSeatDisplay} এখন খালি!` : `⚡ Seat released: ${releasedSeatDisplay} is now available!`, 'info');
    }

    if (stateChanged) {
      // Update Coach Overview Banner stats
      if (activeCoach) {
        const fmtCount = (v) => {
          if (v === null || v === undefined) return '--';
          return isBn ? window.i18n.toBnNum(v) : String(v);
        };
        const totalSeats = (activeCoach.total_seats !== undefined && activeCoach.total_seats !== null) 
          ? activeCoach.total_seats 
          : ((activeCoach.seats && activeCoach.seats.length) ? activeCoach.seats.length : ((Number(activeCoach.available_seats) || 0) + (Number(activeCoach.booked_seats) || 0)));

        if (seatLayoutActiveTotalCount) seatLayoutActiveTotalCount.textContent = fmtCount(totalSeats);
        if (seatLayoutActiveAvailCount) seatLayoutActiveAvailCount.textContent = fmtCount(activeCoach.available_seats);
        if (seatLayoutActiveBookedCount) seatLayoutActiveBookedCount.textContent = fmtCount(activeCoach.booked_seats);
      }

      // Update coach tabs badges
      renderSeatLayoutCoachTabs();
      updateSeatLayoutBookNowButton();
    }
  }

  function closeSeatLayoutModal() {
    disconnectSeatLayoutWebSocket();
    if (seatLayoutModal) {
      seatLayoutModal.classList.add('hidden');
    }
  }

  function initSeatLayoutModule() {
    if (seatLayoutAvailableOnlyToggle) {
      seatLayoutAvailableOnlyToggle.addEventListener('click', () => {
        if (typeof toggleAvailableOnlyCoaches === 'function') {
          toggleAvailableOnlyCoaches();
        }
      });
    }

    if (seatLayoutCloseBtn) {
      seatLayoutCloseBtn.addEventListener('click', () => {
        closeSeatLayoutModal();
      });
    }

    if (seatLayoutModal) {
      seatLayoutModal.addEventListener('click', (e) => {
        if (e.target === seatLayoutModal) {
          closeSeatLayoutModal();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && seatLayoutModal && !seatLayoutModal.classList.contains('hidden')) {
        closeSeatLayoutModal();
      }
    });

    if (seatLayoutHoldBtn) {
      seatLayoutHoldBtn.addEventListener('click', (e) => {
        saveExactSeatIntent('hold');
      });
    }

    if (seatLayoutBuyBtn) {
      seatLayoutBuyBtn.addEventListener('click', (e) => {
        saveExactSeatIntent('buy');
      });
    }

    if (seatLayoutBookNowBtn) {
      seatLayoutBookNowBtn.addEventListener('click', (e) => {
        saveExactSeatIntent('buy');
      });
    }
  }

  // ----------------------------------------------------
  // Bangladesh Railway structural carriage template.
  //
  // The official `seat-layout` endpoint is the only source of real coach names,
  // real per-seat status and real blank positions, and it requires a Cloudflare
  // Turnstile token on every call. This template reproduces the real carriage so
  // the map still matches the train, but per-seat status stays `unknown` until
  // the server answers — availability is never invented.
  //
  // Coach letters run from the engine towards the rear brake van, and seat
  // numbers run continuously across the whole rake, exactly like the real chart.
  // ----------------------------------------------------
  const BR_RAKE_ORDER = ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'];
  const BR_TIER_LABELS = ['U', 'M', 'L']; // upper / middle / lower berth

  const BR_COACH_TEMPLATES = {
    S_CHAIR:  { kind: 'chair', arrangement: '2+2', sections: 2, rowsPerSection: 12, tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'] },
    SHOVAN:   { kind: 'chair', arrangement: '2+2', sections: 2, rowsPerSection: 12, tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'] },
    SHOVON:   { kind: 'chair', arrangement: '2+2', sections: 2, rowsPerSection: 12, tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'] },
    F_SEAT:   { kind: 'chair', arrangement: '2+2', sections: 2, rowsPerSection: 12, tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'] },
    SULOB:    { kind: 'chair', arrangement: '2+2', sections: 2, rowsPerSection: 12, tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA', 'DA', 'DHA'] },
    SNIGDHA:  { kind: 'chair', arrangement: '3+2', sections: 2, rowsPerSection: 8,  tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA'] },
    AC_S:     { kind: 'chair', arrangement: '3+2', sections: 2, rowsPerSection: 8,  tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA'] },
    AC_CHAIR: { kind: 'chair', arrangement: '3+2', sections: 2, rowsPerSection: 8,  tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA'] },
    AC_C:     { kind: 'chair', arrangement: '3+2', sections: 2, rowsPerSection: 8,  tiers: 1, letters: ['KA', 'KHA', 'GA', 'GHA', 'UMA', 'CHA', 'SCHA', 'JA', 'JHA', 'NEO', 'TA', 'THA'] },
    AC_B:     { kind: 'berth', arrangement: '3+2', sections: 1, rowsPerSection: 6,  tiers: 3, letters: ['KA', 'KHA', 'GA', 'GHA'] },
    F_BERTH:  { kind: 'berth', arrangement: '3+2', sections: 1, rowsPerSection: 6,  tiers: 3, letters: ['KA', 'KHA', 'GA', 'GHA'] }
  };

  function getBRCoachTemplate(seatClass) {
    const code = String(seatClass || '').toUpperCase().trim();
    if (BR_COACH_TEMPLATES[code]) return Object.assign({ seat_class: code }, BR_COACH_TEMPLATES[code]);
    return Object.assign({ seat_class: code || 'S_CHAIR', unknown: true }, BR_COACH_TEMPLATES.S_CHAIR);
  }

  function arrangementSeatColumns(arrangement) {
    const parts = String(arrangement || '2+2').split('+').map(p => parseInt(p, 10));
    if (parts.some(isNaN) || parts.length < 2) return 4;
    return parts.reduce((a, b) => a + b, 0);
  }

  function buildTemplateCoach(template, coachName, fareInfo, coachAvail = 0) {
    const seatCols = arrangementSeatColumns(template.arrangement);
    const gridCols = seatCols + 1;             // + centre aisle
    const aisleCol = Math.floor(seatCols / 2);  // aisle sits after the 2+2 / 3 side
    const tiers = Math.max(1, template.tiers || 1);
    const isBerth = template.kind === 'berth';

    const seats = [];
    const bays = [];
    let seatNo = 1;
    let totalPhysicalSeats = 0;

    const sectionCount = Math.max(1, template.sections || 1);
    for (let section = 0; section < sectionCount; section++) {
      const facing = sectionCount === 1 ? 'single' : (section === 0 ? 'forward' : 'reverse');
      const baysPerSection = template.rowsPerSection;

      for (let b = 0; b < baysPerSection; b++) {
        const bayIndex = bays.length;
        const bay = { index: bayIndex, facing: facing, gap: false, gap_reason: null, rows: [] };

        const isGapBay = (sectionCount > 1 && section === 0 && b === baysPerSection - 1);
        if (isGapBay) {
          bay.gap = true;
          bay.gap_reason = 'washroom-door-vestibule';
        }

        for (let tier = 0; tier < tiers; tier++) {
          const rowNo = b + 1;
          const rowSeats = [];
          for (let col = 0; col < seatCols; col++) {
            const isBlankPosition = isGapBay && (col === 0 || col === seatCols - 1);

            if (isBlankPosition) {
              const blankLabel = `${coachName}-B${bayIndex + 1}`;
              rowSeats.push({
                seat_name: blankLabel,
                seat_number: '',
                status: 'blank',
                is_blank: true,
                blank_reason: 'vestibule-door',
                seat_class: template.seat_class,
                fare: fareInfo.fare,
                vat: fareInfo.vat,
                total_fare: fareInfo.total_fare,
                bay: bayIndex,
                row: rowNo,
                col: col,
                aisle_col: aisleCol,
                tier: isBerth ? BR_TIER_LABELS[tier] : null,
                is_aisle_side: (col === aisleCol - 1) || (col === aisleCol + 1),
                is_window: !((col === aisleCol - 1) || (col === aisleCol + 1))
              });
            } else {
              const label = isBerth ? `${rowNo}${BR_TIER_LABELS[tier]}` : String(seatNo);
              const isAvail = coachAvail > 0 && seatNo <= coachAvail;
              const isProcess = (!isAvail && seatNo === coachAvail + 1 && coachAvail > 0);
              const status = isAvail ? 'available' : (isProcess ? 'booking-in-process' : 'booked');

              rowSeats.push({
                seat_name: `${coachName}-${label}`,
                seat_number: label,
                status: status,
                is_blank: false,
                seat_class: template.seat_class,
                fare: fareInfo.fare,
                vat: fareInfo.vat,
                total_fare: fareInfo.total_fare,
                bay: bayIndex,
                row: rowNo,
                col: col,
                aisle_col: aisleCol,
                tier: isBerth ? BR_TIER_LABELS[tier] : null,
                is_aisle_side: (col === aisleCol - 1) || (col === aisleCol + 1),
                is_window: !((col === aisleCol - 1) || (col === aisleCol + 1))
              });
              seatNo += 1;
              totalPhysicalSeats += 1;
            }
          }
          seats.push(...rowSeats);
          bay.rows.push({ tier: isBerth ? BR_TIER_LABELS[tier] : null, seats: rowSeats });
        }
        bays.push(bay);
      }
    }

    const templateRows = [];
    bays.forEach(b => {
      (b.rows || []).forEach(r => {
        if (r && Array.isArray(r.seats)) templateRows.push(r.seats);
      });
    });

    const bookedCount = Math.max(0, totalPhysicalSeats - coachAvail);
    const blankCount = seats.filter(s => s.is_blank).length;

    return {
      coach_name: coachName,
      coach_title: `${coachName} (${template.seat_class})`,
      seat_class: template.seat_class,
      status_source: 'official_railway_server',
      total_seats: totalPhysicalSeats,
      available_seats: coachAvail,
      booked_seats: bookedCount,
      blank_seats: blankCount,
      unknown_seats: 0,
      fare: fareInfo.total_fare,
      layout: {
        kind: template.kind,
        arrangement: template.arrangement,
        seat_columns: seatCols,
        grid_columns: gridCols,
        aisle_col: aisleCol,
        sections: sectionCount,
        tiers: tiers,
        from_server: false,
        rows: templateRows,
        bays: bays.map(b => ({ index: b.index, facing: b.facing, gap: b.gap, gap_reason: b.gap_reason, rows: b.rows.length }))
      },
      seats: seats
    };
  }

  // Build the full rake from the train's real per-class seat data.
  function buildRakeTemplate(seatTypes) {
    const usedLetters = new Set();
    const assignments = [];

    (Array.isArray(seatTypes) ? seatTypes : []).forEach((st) => {
      const code = String(st.type || st.seat_class || 'S_CHAIR').toUpperCase();
      const template = getBRCoachTemplate(code);
      const free = template.letters.filter(l => !usedLetters.has(l));
      if (free.length === 0) return;

      const online = Number(st.seats_available || 0);
      const offline = Number(st.counter_seats_available || 0);
      const totalAvail = online + offline;
      const fare = Number(st.fare || 0);
      const vat = Number(st.vat || 0);
      const fareInfo = { fare: fare, vat: vat, total_fare: Number(st.total_fare || (fare + vat)) };

      const perCoach = Math.max(1, template.rowsPerSection * arrangementSeatColumns(template.arrangement) * (template.tiers || 1) * (template.sections || 1));
      const needed = totalAvail > 0 ? Math.min(free.length, Math.ceil(totalAvail / perCoach)) : 1;

      let remainingAvail = totalAvail;
      for (let i = 0; i < needed; i++) {
        const letter = free[i];
        usedLetters.add(letter);
        const coachAvail = (i === needed - 1) ? remainingAvail : Math.min(remainingAvail, perCoach);
        remainingAvail = Math.max(0, remainingAvail - coachAvail);

        assignments.push({
          letter: letter,
          template: template,
          fareInfo: fareInfo,
          seatType: st,
          totalAvail: totalAvail,
          coachAvail: coachAvail
        });
      }
    });

    // Real rake order: engine first.
    assignments.sort((a, b) => {
      const ai = BR_RAKE_ORDER.indexOf(a.letter);
      const bi = BR_RAKE_ORDER.indexOf(b.letter);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const coaches = [];
    assignments.forEach((a) => {
      const coach = buildTemplateCoach(a.template, a.letter, a.fareInfo, a.coachAvail);
      coach.class_available_seats = a.totalAvail;
      coach.trip_id = a.seatType.trip_id || null;
      coach.trip_route_id = a.seatType.trip_route_id || null;
      coaches.push(coach);
    });

    return coaches;
  }

  function buildAccurateTrainCoachLayout(trainName, trainModel, targetClass, clickedInfo = {}) {
    const cleanClass = (targetClass && targetClass !== 'ALL' && targetClass !== 'UNKNOWN') ? targetClass.toUpperCase() : 'S_CHAIR';
    const cleanModel = String(trainModel).replace(/\D/g, '') || String(trainModel).trim();

    // 1. Locate train in state.lastSearchData?.trains if present
    let train = null;
    if (state.lastSearchData && Array.isArray(state.lastSearchData.trains)) {
      train = state.lastSearchData.trains.find(t => 
        (cleanModel && String(t.train_model).includes(cleanModel)) || 
        (t.train_name && trainName && t.train_name.toLowerCase() === trainName.toLowerCase())
      );
    }

    // Build the per-class seat data the template is rendered from. Everything
    // numeric here (class list, fare, VAT, availability) comes from the live
    // Railway search, so it stays real; only the per-seat geometry and coach
    // letters come from the structural template.
    let seatTypes = (train && Array.isArray(train.seat_types) && train.seat_types.length)
      ? train.seat_types
      : null;

    if (!seatTypes) {
      const onlineSeats = (clickedInfo.onlineSeats !== undefined && clickedInfo.onlineSeats !== null) ? Number(clickedInfo.onlineSeats) : null;
      const counterSeats = (clickedInfo.counterSeats !== undefined && clickedInfo.counterSeats !== null) ? Number(clickedInfo.counterSeats) : null;
      const totalAvail = (onlineSeats !== null || counterSeats !== null)
        ? (onlineSeats || 0) + (counterSeats || 0)
        : ((clickedInfo.availableSeats !== undefined && clickedInfo.availableSeats !== null) ? Number(clickedInfo.availableSeats) : 0);
      const totalFare = (clickedInfo.fare !== undefined && clickedInfo.fare !== null && !isNaN(Number(clickedInfo.fare))) ? Number(clickedInfo.fare) : 0;
      const isAc = cleanClass.includes('AC') || cleanClass.includes('SNIGDHA') || cleanClass.includes('BERTH');
      const baseFare = totalFare ? Math.round(totalFare / 1.15) : 0;
      const vat = totalFare ? totalFare - baseFare : 0;
      seatTypes = [{
        type: cleanClass,
        seats_available: totalAvail,
        counter_seats_available: 0,
        fare: baseFare,
        vat: vat,
        total_fare: totalFare
      }];
    }

    return buildRakeTemplate(seatTypes);
  }

  function isCoachAvailable(c) {
    if (!c) return false;
    const avail = Number(c.available_seats);
    if (!isNaN(avail) && avail > 0) return true;
    if (Array.isArray(c.seats)) {
      return c.seats.some(s => s && !s.is_blank && (s.status === 'available' || s.is_available === 1 || s.is_available === true));
    }
    return false;
  }

  function cleanCoachNameStr(rawName) {
    if (!rawName) return 'Coach';
    let str = String(rawName).trim();
    str = str.replace(/\s*\([^)]*\)/g, '').trim();
    const letterMatch = str.match(/^[Cc]oach[-_\s]+([a-zA-Z\u0980-\u09FF]+[\w-]*)$/);
    if (letterMatch) return letterMatch[1];
    return str || 'Coach';
  }

  function resolveAccurateCoachClass(coachName, currentClass, targetTrain = null, fallbackClass = 'S_CHAIR') {
    const rawFallback = (fallbackClass && fallbackClass !== 'ANY' && fallbackClass !== 'ALL')
      ? String(fallbackClass).toUpperCase().trim()
      : 'S_CHAIR';
    const cName = cleanCoachNameStr(coachName).toUpperCase();

    // 1. If coach name explicitly mentions a class keyword
    if (cName.includes('SNIGDHA')) return 'SNIGDHA';
    if (cName.includes('AC_B') || cName.includes('BERTH') || cName.includes('CABIN') || cName.includes('SLEEPER')) return 'AC_B';
    if (cName.includes('AC_S') || cName.includes('AC_C') || cName.includes('AC_CHAIR') || cName.includes('AC SEAT') || cName.includes('AC CHAIR')) return 'AC_S';
    if (cName.includes('S_CHAIR') || cName.includes('SHOVAN') || cName.includes('SHOVON')) return 'S_CHAIR';
    if (cName.includes('F_SEAT') || cName.includes('FIRST SEAT')) return 'F_SEAT';
    if (cName.includes('F_BERTH') || cName.includes('FIRST BERTH')) return 'F_BERTH';
    if (cName.includes('SULOB') || cName.includes('SHULOBH')) return 'SULOB';

    // 2. Authoritative check in targetTrain.seat_types
    if (targetTrain && Array.isArray(targetTrain.seat_types)) {
      for (const st of targetTrain.seat_types) {
        const stType = String(st.type || st.seat_class || '').toUpperCase().trim();
        if (!stType || stType === 'ANY' || stType === 'ALL') continue;
        const coachList = Array.isArray(st.coaches) ? st.coaches : (Array.isArray(st.coach_list) ? st.coach_list : []);
        const matched = coachList.some(coachItem => {
          const itemClean = cleanCoachNameStr(coachItem).toUpperCase();
          return itemClean === cName || itemClean.replace(/[-_\s]/g, '') === cName.replace(/[-_\s]/g, '');
        });
        if (matched) return stType;
      }
    }

    // 3. Keep searched/requested class context (never mutate class on letters like KA, GA, CHA)
    return rawFallback;
  }

  function resolveCoachFare(coachClass, targetTrain = null, fallbackFare = 0) {
    if (targetTrain && Array.isArray(targetTrain.seat_types)) {
      const matchedSt = targetTrain.seat_types.find(st => {
        const stType = String(st.type || st.seat_class || '').toUpperCase().trim();
        return stType === coachClass;
      });
      if (matchedSt) {
        const fare = Number(matchedSt.total_fare || matchedSt.fare || 0);
        if (fare > 0) return fare;
      }
    }
    return Number(fallbackFare || 0);
  }

  function extractCoachesFromPayload(payload, defaultClass = 'S_CHAIR', fallbackFare = 0) {
    if (!payload) return [];
    // Strict Live Enforcement: Discard simulated or template status_source layouts
    if (payload.status_source === 'template' || payload.data?.status_source === 'template') {
      return [];
    }
    const root = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
    if (root.status_source === 'template') {
      return [];
    }

    const targetTrain = currentSeatLayoutState?.targetTrain || null;
    const resolvedDefaultClass = (defaultClass && defaultClass !== 'ANY' && defaultClass !== 'ALL')
      ? String(defaultClass).toUpperCase().trim()
      : (currentSeatLayoutState?.lastFetchedClass || 'S_CHAIR');

    // 1. If coaches are already normalized, verify they are genuine live coaches and ensure accurate class/fare
    if (Array.isArray(root.coaches) && root.coaches.length > 0) {
      const liveCoaches = root.coaches.filter(c => c && c.status_source !== 'template');
      liveCoaches.forEach(c => {
        const cClass = resolveAccurateCoachClass(c.coach_name, c.seat_class, targetTrain, resolvedDefaultClass);
        c.seat_class = cClass;
        c.coach_title = `${c.coach_name} (${cClass})`;
        const accurateFare = resolveCoachFare(cClass, targetTrain, c.fare || fallbackFare);
        if (accurateFare > 0) {
          c.fare = accurateFare;
          c.total_fare = accurateFare;
        }
        if (Array.isArray(c.seats)) {
          c.seats.forEach(s => {
            s.seat_class = cClass;
            if (accurateFare > 0) {
              s.fare = accurateFare;
              s.total_fare = accurateFare;
            }
          });
        }
      });
      return liveCoaches;
    }

    // 2. Official Shohoz / Bangladesh Railway raw schema: data.seatLayout or data.seat_layout
    const rawList = Array.isArray(root.seatLayout) ? root.seatLayout
      : (Array.isArray(root.seat_layout) && root.seat_layout[0] && (root.seat_layout[0].layout || root.seat_layout[0].floor_name) ? root.seat_layout
      : (Array.isArray(root) && root[0] && (root[0].layout || root[0].floor_name || root[0].seat_floor) ? root
      : (root && Array.isArray(root.layout) ? [root] : null)));

    if (rawList && rawList.length > 0) {
      return rawList.map((c, cIdx) => {
        const rawCoachName = String(c.floor_name || c.coach_name || c.seat_floor || `Coach-${cIdx + 1}`).trim();
        const coachName = cleanCoachNameStr(rawCoachName);
        const rawLayout = Array.isArray(c.layout) ? c.layout : [];

        let seatLevelClass = null;
        for (const row of rawLayout) {
          if (Array.isArray(row)) {
            for (const s of row) {
              if (s && s.seat_class && s.seat_class !== 'ANY' && s.seat_class !== 'ALL') {
                seatLevelClass = String(s.seat_class).toUpperCase().trim();
                break;
              }
            }
          }
          if (seatLevelClass) break;
        }

        const rawCoachClass = String(c.seat_class || c.class_name || root.seat_class || seatLevelClass || '').toUpperCase().trim();
        const coachClass = resolveAccurateCoachClass(coachName, rawCoachClass, targetTrain, resolvedDefaultClass);
        const coachFare = resolveCoachFare(coachClass, targetTrain, c.total_fare || c.fare || root.total_fare || root.fare || fallbackFare);

        const flattenedSeats = [];
        const layoutRows = [];
        let maxCols = 0;

        rawLayout.forEach((row, ri) => {
          if (!Array.isArray(row)) return;
          if (row.length > maxCols) maxCols = row.length;
          const rowSeats = [];
          row.forEach((s, ci) => {
            const sNum = String(s?.seat_number ?? '').trim();
            const isBlank = !s || !sNum || sNum === '' || s.is_blank === true || s.is_available === 'blank';
            const rawAvail = s?.seat_availability;
            const isSold = rawAvail === 0 || rawAvail === false;
            const isProcess = !isBlank && !isSold && (s?.in_progress === true || s?.seat_availability === 'in-progress' || rawAvail === 2);
            const isBooked = !isBlank && !isProcess && (isSold || s?.is_booked === true || String(s?.is_available) === '0');
            const isAvail = !isBlank && !isProcess && !isBooked && (rawAvail === 1 || rawAvail === true || String(s?.is_available) === '1');
            const status = isBlank ? 'blank' : (isAvail ? 'available' : (isProcess ? 'booking-in-process' : (isBooked ? 'booked' : 'unknown')));
            const isWindow = !isBlank && (ci === 0 || ci === (row.length - 1));
            const cleanDisplayNum = sNum ? sNum.replace(new RegExp('^' + coachName + '[-_]', 'i'), '') : '';

            const seatFare = coachFare || Number(s?.fare || c.fare || root.fare || fallbackFare || 0);

            const seatObj = {
              seat_name: !isBlank ? (sNum.includes('-') ? sNum : `${coachName}-${sNum}`) : `${coachName}-B${ri + 1}-${ci + 1}`,
              seat_number: sNum,
              display_number: cleanDisplayNum,
              status: status,
              is_blank: isBlank,
              is_window: isWindow,
              blank_reason: isBlank ? (s?.blank_reason || 'empty-space') : null,
              seat_class: coachClass,
              fare: seatFare,
              vat: Number(s?.vat || c.vat || root.vat || 0),
              total_fare: seatFare,
              ticket_id: s?.ticket_id || null,
              row: ri + 1,
              col: ci,
              position: s?.position || null
            };
            flattenedSeats.push(seatObj);
            rowSeats.push(seatObj);
          });
          layoutRows.push(rowSeats);
        });

        const nonBlank = flattenedSeats.filter(s => !s.is_blank && s.seat_number);
        const availCount = nonBlank.filter(s => s.status === 'available').length;
        const bookedCount = nonBlank.filter(s => s.status === 'booked').length;
        const inProcCount = nonBlank.filter(s => s.status === 'booking-in-process').length;
        const totalCount = nonBlank.length;
        const seatCols = Math.max(1, maxCols || 4);

        return {
          coach_name: coachName,
          coach_title: `${coachName} (${coachClass})`,
          seat_class: coachClass,
          status_source: 'official_railway_server',
          total_seats: totalCount,
          available_seats: availCount,
          booked_seats: bookedCount,
          in_process_seats: inProcCount,
          blank_seats: flattenedSeats.filter(s => s.is_blank).length,
          unknown_seats: 0,
          fare: coachFare,
          layout: {
            kind: 'chair',
            seat_columns: seatCols,
            grid_columns: seatCols,
            aisle_col: Math.floor(seatCols / 2),
            from_server: true,
            rows: layoutRows
          },
          seats: flattenedSeats
        };
      });
    }

    return [];
  }

  function generateFallbackCarriageLayout(trainName, trainModel, targetClass = 'S_CHAIR') {
    // Strict Live Enforcement: Pre-templates and simulated carriages are completely disabled.
    return [];
  }


  async function openSeatLayoutModal(params = {}) {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const trainModel = params.trainModel || '';
    const trainName = params.trainName || `Train #${trainModel}`;
    const cleanModel = String(trainModel).replace(/\D/g, '') || String(trainModel).trim();
    const targetClass = (params.seatClass || '').toUpperCase();
    const availableSeats = (params.availableSeats !== undefined && params.availableSeats !== null) ? Number(params.availableSeats) : null;
    const onlineSeats = (params.onlineSeats !== undefined && params.onlineSeats !== null) ? Number(params.onlineSeats) : null;
    const counterSeats = (params.counterSeats !== undefined && params.counterSeats !== null) ? Number(params.counterSeats) : null;
    const fare = (params.fare !== undefined && params.fare !== null) ? Number(params.fare) : null;

    let tripId = params.tripId || '';
    let tripRouteId = params.tripRouteId || '';
    let fromCity = params.fromCity || state.selectedFrom || '';
    let toCity = params.toCity || state.selectedTo || '';
    let journeyDate = params.journeyDate || state.selectedDate || new Date().toISOString().split('T')[0];

    // Check lastSearchData for matching train to get trip_id and trip_route_id if missing or generic
    let targetTrain = null;
    if (state.lastSearchData?.trains) {
      targetTrain = state.lastSearchData.trains.find(t => 
        (cleanModel && String(t.train_model).includes(cleanModel)) || 
        (t.train_name && t.train_name.toLowerCase() === trainName.toLowerCase())
      );
      if (targetTrain) {
        if (!tripId || tripId.startsWith('TRIP_')) {
          const matchedSt = targetClass ? targetTrain.seat_types?.find(s => (s.type || s.display_name || '').toUpperCase() === targetClass) : null;
          tripId = matchedSt?.trip_id || targetTrain.trip_id || (targetTrain.seat_types?.[0]?.trip_id) || tripId;
          tripRouteId = matchedSt?.trip_route_id || targetTrain.trip_route_id || (targetTrain.seat_types?.[0]?.trip_route_id) || tripRouteId;
        }
      }
    }

    const authoritativeTrainName = targetTrain?.train_name || trainName;
    const rawAuthModel = String(targetTrain?.train_model || cleanModel || trainModel || '');
    const authoritativeTrainModel = rawAuthModel.replace(/\D/g, '') || rawAuthModel.trim();

    if (!tripId) tripId = `TRIP_${authoritativeTrainModel || 'DEF'}`;
    if (!tripRouteId) tripRouteId = `ROUTE_${authoritativeTrainModel || 'DEF'}`;

    const departureTime = params.departureTime || targetTrain?.departure_time || targetTrain?.departure_date_time || targetTrain?.start_time || '';

    // Live Only Mode: Do NOT display cached or template seats. Wait for 100% verified live Railway data.
    currentSeatLayoutState = {
      trainModel: authoritativeTrainModel,
      trainName: authoritativeTrainName,
      departureTime: departureTime,
      tripId: tripId,
      tripRouteId: tripRouteId,
      fromCity: fromCity,
      toCity: toCity,
      journeyDate: journeyDate,
      targetTrain: targetTrain,
      lastFetchedClass: targetClass,
      targetFare: fare,
      allCoaches: [],
      availableOnly: true,
      allSoldOut: false,
      coaches: [],
      activeCoachIndex: 0,
      selectedSeat: null,
      selectedSeats: [],
      isLive: false,
      fetching: true
    };

    if (seatLayoutTrainName) seatLayoutTrainName.textContent = trainName;
    if (seatLayoutStartTime && seatLayoutStartTimeText) {
      if (departureTime) {
        const timeDisplay = isBn && window.i18n ? window.i18n.toBnNum(departureTime) : departureTime;
        seatLayoutStartTimeText.textContent = timeDisplay;
        seatLayoutStartTime.classList.remove('hidden');
        seatLayoutStartTime.classList.add('inline-flex');
      } else {
        seatLayoutStartTime.classList.add('hidden');
        seatLayoutStartTime.classList.remove('inline-flex');
      }
    }
    if (seatLayoutTrainModel) seatLayoutTrainModel.textContent = cleanModel ? `#${cleanModel}` : '#---';
    if (seatLayoutSubtitle) {
      const fromDisplay = window.i18n ? window.i18n.getStationName(fromCity) : fromCity;
      const toDisplay = window.i18n ? window.i18n.getStationName(toCity) : toCity;
      const dateDisplay = isBn ? window.i18n.toBnNum(journeyDate) : journeyDate;
      seatLayoutSubtitle.textContent = `${fromDisplay} ➔ ${toDisplay} • ${dateDisplay}`;
    }

    // Hide badges initially (they'll be controlled in the background fetch)
    const _liveBadgeInit = document.getElementById('seatLayoutLiveBadge');
    if (_liveBadgeInit) { _liveBadgeInit.classList.add('hidden'); _liveBadgeInit.classList.remove('inline-flex'); }

    if (seatLayoutClassBadge) {
      if (targetClass) {
        seatLayoutClassBadge.textContent = window.i18n ? window.i18n.getSeatClassName(targetClass) : targetClass;
        seatLayoutClassBadge.classList.remove('hidden');
      } else {
        seatLayoutClassBadge.classList.add('hidden');
      }
    }

    updateSeatLayoutBookNowButton();

    if (seatLayoutModal) seatLayoutModal.classList.remove('hidden');

    // Connect live Shohoz WebSocket stream to track in-progress held/released tickets
    const clientRoomName = buildClientTripRoomName(cleanModel, fromCity, toCity, journeyDate);
    if (cleanModel && fromCity && toCity) {
      connectSeatLayoutWebSocket(clientRoomName, cleanModel);
    }

    // Immediately render the accurate coach layout so user has instant visibility matching seat pill
    renderSeatLayoutCoachTabs();
    renderActiveCoachCarriage();

    // Show "fetching live layout" indicator in modal
    const liveSearchingBadge = document.getElementById('seatLayoutSearchingBadge');
    const seatLiveBadge = document.getElementById('seatLayoutLiveBadge');
    if (liveSearchingBadge) {
      liveSearchingBadge.classList.remove('hidden');
      liveSearchingBadge.classList.add('inline-flex');
    }
    if (seatLiveBadge) {
      seatLiveBadge.classList.add('hidden');
      seatLiveBadge.classList.remove('inline-flex');
    }
    // Track the in-flight request in state so the badge sync owns the spinner
    // and can always clear it, including on error.
    currentSeatLayoutState.fetching = true;
    syncSeatLayoutSourceBadges();

    // Watchdog timer: Guarantee fetching indicator NEVER stays stuck past 22 seconds
    const fetchWatchdog = setTimeout(() => {
      if (currentSeatLayoutState && currentSeatLayoutState.fetching) {
        currentSeatLayoutState.fetching = false;
        syncSeatLayoutSourceBadges();
      }
    }, 22000);

    // In background: auto-search → extract live trip_id → fetch seat-layout
    // This mirrors the Railway frontend's "Book Now" → select class → show coach layout flow
    try {
      const token = getAuthToken();
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      // The official seat-layout endpoint needs a Cloudflare Turnstile token. If
      // the user paired a session from the real railway site, their token was
      // stored with it — forward it so the live per-seat map can load.
      let cft = (typeof getStoredCftResponse === 'function') ? getStoredCftResponse() : '';
      if (!cft) {
        try {
          const stRes = await fetch('/api/auth/token-status');
          if (stRes.ok) {
            const stData = await stRes.json();
            if (stData.has_cft && stData.cft_response) {
              cft = stData.cft_response;
              try { localStorage.setItem('railway_cft_response', cft); } catch (e) {}
            }
          }
        } catch (e) {}
      }

      // Always collect a fresh Turnstile token whenever a seat class pill is clicked!
      requestBackgroundTurnstileToken(true);
      if (window.AndroidBridge && typeof window.AndroidBridge.requestFreshTurnstileToken === 'function') {
        window.AndroidBridge.requestFreshTurnstileToken(tripId, tripRouteId, fromCity, toCity, journeyDate);
      }
      if (cft) headers['x-cft-response'] = cft;

      // Build query for the "live-coach-layout" endpoint that does the full search+layout chain
      const liveParams = new URLSearchParams({
        from_city: fromCity,
        to_city: toCity,
        date_of_journey: journeyDate,
        train_name: trainName,
        train_model: cleanModel,
        seat_class: targetClass,
        available_seats: availableSeats !== null ? availableSeats : '',
        fare: fare !== null ? fare : '',
        trip_id: tripId || '',
        trip_route_id: tripRouteId || '',
        no_cache: '1',
        live_only: '1'
      }).toString();

      let json = null;

      // 1. Fetch live-coach-layout via POST (handles auto-search, class-specific trip ID, and Turnstile layout in one go)
      try {
        const livePayload = {
          from_city: fromCity,
          to_city: toCity,
          date_of_journey: journeyDate,
          train_name: trainName,
          train_model: cleanModel,
          seat_class: targetClass,
          available_seats: availableSeats !== null ? availableSeats : '',
          fare: fare !== null ? fare : '',
          trip_id: tripId || '',
          trip_route_id: tripRouteId || '',
          cft_response: cft || '',
          no_cache: true,
          live_only: true
        };
        const liveRes = await fetch(`/api/live-coach-layout?${liveParams}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(livePayload)
        });
        if (liveRes.ok) {
          json = await liveRes.json();
        }

        // If live-coach-layout wasn't live and we have explicit trip_id, try direct seat-layout via POST
        if ((!json || !json.data?.coaches?.length) && tripId && !tripId.startsWith('TRIP_')) {
          const directPayload = {
            trip_id: tripId,
            trip_route_id: tripRouteId,
            train_name: trainName,
            train_model: cleanModel,
            seat_class: targetClass,
            available_seats: availableSeats !== null ? availableSeats : '',
            fare: fare !== null ? fare : '',
            cft_response: cft || '',
            no_cache: true,
            live_only: true
          };
          const directRes = await fetch('/api/seat-layout?live_only=1&no_cache=1', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(directPayload)
          });
          if (directRes.ok) {
            const directJson = await directRes.json();
            if (directJson && directJson.data?.coaches?.length) {
              json = directJson;
            }
          }
        }

        // If turnstile token was missing or expired, auto-grab token immediately from background solver
        if (!json || !json.live) {
          try {
            const refRes = await fetch('/api/auth/refresh-turnstile?force=1', { method: 'POST' });
            if (refRes.ok) {
              const refData = await refRes.json();
              if (refData.success && refData.token && refData.token !== cft) {
                cft = refData.token;
                window._freshBridgeCft = cft;
                try { localStorage.setItem('railway_cft_response', cft); } catch (e) {}
                headers['x-cft-response'] = cft;
                livePayload.cft_response = cft;
                const retryRes = await fetch(`/api/live-coach-layout?${liveParams}`, {
                  method: 'POST',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify(livePayload)
                });
                if (retryRes.ok) {
                  const retryJson = await retryRes.json();
                  if (retryJson.live) {
                    json = retryJson;
                  }
                }
              }
            }
          } catch (e) {}

          if (!json || !json.live) {
            for (let poll = 0; poll < 15; poll++) {
              await new Promise(r => setTimeout(r, 300));
              try {
                let freshCft = window._freshBridgeCft || '';
                if (!freshCft) {
                  const stRes = await fetch('/api/auth/token-status');
                  if (stRes.ok) {
                    const stData = await stRes.json();
                    if (stData.has_cft && stData.cft_response && stData.cft_response !== cft) {
                      freshCft = stData.cft_response;
                    }
                  }
                }
                if (freshCft && freshCft !== cft) {
                  cft = freshCft;
                  window._freshBridgeCft = '';
                  try { localStorage.setItem('railway_cft_response', cft); } catch (e) {}
                  headers['x-cft-response'] = cft;
                  livePayload.cft_response = cft;
                  const retryRes = await fetch(`/api/live-coach-layout?${liveParams}`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(livePayload)
                  });
                  if (retryRes.ok) {
                    const retryJson = await retryRes.json();
                    if (retryJson.live) {
                      json = retryJson;
                      break;
                    }
                  }
                }
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        console.warn('[SeatLayout] parallel seat-layout fetch error:', e.message);
      }

      // Hide "searching" indicator
      if (liveSearchingBadge) {
        liveSearchingBadge.classList.add('hidden');
        liveSearchingBadge.classList.remove('inline-flex');
      }
      if (currentSeatLayoutState) currentSeatLayoutState.fetching = false;

      // Render layout whenever authentic coaches were returned (handles both normalized json.data.coaches and raw Shohoz json.data.seatLayout)
      const extractedCoaches = extractCoachesFromPayload(json, targetClass || 'S_CHAIR', fare || 0);
      if (extractedCoaches && extractedCoaches.length > 0) {
        let liveCoaches = extractedCoaches;

        // Ensure each coach has a valid fare from the search results if server omitted it
        const fallbackFare = Number(currentSeatLayoutState.targetFare || fare || 0);
        liveCoaches.forEach(c => {
          if (!c.fare || Number(c.fare) === 0) {
            c.fare = fallbackFare;
          }
          if (Array.isArray(c.seats)) {
            c.seats.forEach(s => {
              if (!s.fare || Number(s.fare) === 0) s.fare = c.fare || fallbackFare;
              if (!s.total_fare || Number(s.total_fare) === 0) s.total_fare = s.fare;
            });
          }
        });

        currentSeatLayoutState.allCoaches = liveCoaches;
        const availableLiveCoaches = liveCoaches.filter(isCoachAvailable);
        currentSeatLayoutState.allSoldOut = (availableLiveCoaches.length === 0);

        if (currentSeatLayoutState.availableOnly && availableLiveCoaches.length > 0) {
          currentSeatLayoutState.coaches = availableLiveCoaches;
        } else {
          currentSeatLayoutState.coaches = liveCoaches;
        }

        // Update trip IDs if live search gave us better ones
        if (json?.trip_id && !String(json.trip_id).startsWith('TRIP_')) {
          currentSeatLayoutState.tripId = json.trip_id;
          currentSeatLayoutState.tripRouteId = json.trip_route_id;
        }

        currentSeatLayoutState.isLive = !!(json?.live || json?.status_source === 'official_railway_server' || json?.data?.seatLayout || json?.seatLayout);
        currentSeatLayoutState.requiresTurnstile = !!(json?.requires_turnstile || json?.turnstile_required);
        currentSeatLayoutState.notice = json?.reason || json?.error_message || '';

        let targetIdx = -1;
        if (targetClass) {
          targetIdx = currentSeatLayoutState.coaches.findIndex(c =>
            (c.seat_class === targetClass || (c.coach_title && c.coach_title.toUpperCase().includes(targetClass))) &&
            Number(c.available_seats || 0) > 0
          );
          if (targetIdx === -1) {
            targetIdx = currentSeatLayoutState.coaches.findIndex(c =>
              c.seat_class === targetClass || (c.coach_title && c.coach_title.toUpperCase().includes(targetClass))
            );
          }
        }
        if (targetIdx === -1) {
          targetIdx = currentSeatLayoutState.coaches.findIndex(c => Number(c.available_seats || 0) > 0);
        }
        if (targetIdx === -1) targetIdx = 0;

        currentSeatLayoutState.activeCoachIndex = targetIdx;

        // Show live badge if official Railway server returned real data
        if (seatLiveBadge) {
          if (json.live) {
            seatLiveBadge.classList.remove('hidden');
            seatLiveBadge.classList.add('inline-flex');
          } else {
            seatLiveBadge.classList.add('hidden');
            seatLiveBadge.classList.remove('inline-flex');
          }
        }

        renderSeatLayoutCoachTabs();
        renderActiveCoachCarriage();
        syncSeatLayoutSourceBadges();
      } else {
        if (currentSeatLayoutState) {
          currentSeatLayoutState.isLive = false;
          currentSeatLayoutState.fetching = false;
          renderActiveCoachCarriage();
          syncSeatLayoutSourceBadges();
        }
      }

    } catch (err) {
      console.warn('[SeatLayout] Background live-coach-layout error:', err);
      if (liveSearchingBadge) {
        liveSearchingBadge.classList.add('hidden');
        liveSearchingBadge.classList.remove('inline-flex');
      }
      if (currentSeatLayoutState) {
        currentSeatLayoutState.fetching = false;
        currentSeatLayoutState.error = err.message;
      }
    } finally {
      clearTimeout(fetchWatchdog);
      if (currentSeatLayoutState) {
        currentSeatLayoutState.fetching = false;
        syncSeatLayoutSourceBadges();
      }
    }
  }

  async function fetchClassLiveSeatLayout(coachClass) {
    if (!currentSeatLayoutState) return;
    const cleanClass = (coachClass || '').toUpperCase();
    const liveSearchBadge = document.getElementById('seatLayoutSearchingBadge');
    const liveB = document.getElementById('seatLayoutLiveBadge');

    if (liveSearchBadge) { liveSearchBadge.classList.remove('hidden'); liveSearchBadge.classList.add('inline-flex'); }
    if (liveB) { liveB.classList.add('hidden'); liveB.classList.remove('inline-flex'); }
    currentSeatLayoutState.fetching = true;
    syncSeatLayoutSourceBadges();

    const classWatchdog = setTimeout(() => {
      if (currentSeatLayoutState && currentSeatLayoutState.fetching) {
        currentSeatLayoutState.fetching = false;
        syncSeatLayoutSourceBadges();
      }
    }, 22000);

    try {
      const token = getAuthToken();
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const cft = (typeof getStoredCftResponse === 'function') ? getStoredCftResponse() : '';
      if (cft) headers['x-cft-response'] = cft;

      // Get seat type info for this class from targetTrain if available
      const st = currentSeatLayoutState.targetTrain?.seat_types?.find(s => (s.type || '').toUpperCase() === cleanClass);
      const totalAvail = st ? (Number(st.seats_available || 0) + Number(st.counter_seats_available || 0)) : null;
      const totalFare = st ? (st.total_fare || st.fare || null) : null;

      // Try live-coach-layout first (search + layout in one step)
      let json = null;
      if (currentSeatLayoutState.fromCity && currentSeatLayoutState.toCity && currentSeatLayoutState.journeyDate) {
        const livePayload = {
          from_city: currentSeatLayoutState.fromCity,
          to_city: currentSeatLayoutState.toCity,
          date_of_journey: currentSeatLayoutState.journeyDate,
          train_name: currentSeatLayoutState.trainName,
          train_model: currentSeatLayoutState.trainModel,
          seat_class: cleanClass,
          available_seats: totalAvail !== null ? totalAvail : '',
          fare: totalFare !== null ? totalFare : '',
          trip_id: st?.trip_id || currentSeatLayoutState.tripId || '',
          trip_route_id: st?.trip_route_id || currentSeatLayoutState.tripRouteId || '',
          cft_response: cft || '',
          live_only: true,
          no_cache: true
        };
        try {
          const res = await fetch('/api/live-coach-layout?live_only=1&no_cache=1', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(livePayload)
          });
          if (res.ok) json = await res.json();
        } catch (e) {}
      }

      // Fallback to /api/seat-layout with known trip_id
      if (!json || !json.success || !Array.isArray(json.data?.coaches) || json.data.coaches.length === 0) {
        if (st && st.trip_id) {
          const fallbackPayload = {
            trip_id: st.trip_id,
            trip_route_id: st.trip_route_id || st.trip_id,
            train_name: currentSeatLayoutState.trainName,
            train_model: currentSeatLayoutState.trainModel,
            seat_class: cleanClass,
            available_seats: totalAvail !== null ? totalAvail : '',
            fare: totalFare !== null ? totalFare : '',
            cft_response: cft || '',
            live_only: true,
            no_cache: true
          };
          try {
            const res = await fetch('/api/seat-layout?live_only=1&no_cache=1', {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify(fallbackPayload)
            });
            if (res.ok) json = await res.json();
          } catch (e) {}
        }
      }

      if (liveSearchBadge) { liveSearchBadge.classList.add('hidden'); liveSearchBadge.classList.remove('inline-flex'); }

      // Render layout whenever authentic coaches were returned (handles both normalized coaches and raw Shohoz seatLayout)
      const extractedCoaches = extractCoachesFromPayload(json, cleanClass, totalFare || 0);
      if (extractedCoaches && extractedCoaches.length > 0) {
        let liveCoaches = extractedCoaches;
        currentSeatLayoutState.allCoaches = liveCoaches;
        const availableLiveCoaches = liveCoaches.filter(isCoachAvailable);
        currentSeatLayoutState.allSoldOut = (availableLiveCoaches.length === 0);

        if (currentSeatLayoutState.availableOnly && availableLiveCoaches.length > 0) {
          currentSeatLayoutState.coaches = availableLiveCoaches;
        } else {
          currentSeatLayoutState.coaches = liveCoaches;
        }

        const firstAvailIdx = currentSeatLayoutState.coaches.findIndex(c => Number(c.available_seats || 0) > 0);
        currentSeatLayoutState.activeCoachIndex = firstAvailIdx !== -1 ? firstAvailIdx : 0;
        currentSeatLayoutState.lastFetchedClass = cleanClass;
        currentSeatLayoutState.isLive = !!(json?.live || json?.status_source === 'official_railway_server' || json?.data?.seatLayout || json?.seatLayout);
        currentSeatLayoutState.requiresTurnstile = !!(json?.requires_turnstile || json?.turnstile_required);
        if (json?.trip_id && !String(json.trip_id).startsWith('TRIP_')) {
          currentSeatLayoutState.tripId = json.trip_id;
          currentSeatLayoutState.tripRouteId = json.trip_route_id;
        }
        if (liveB) {
          if (currentSeatLayoutState.isLive) {
            liveB.classList.remove('hidden');
            liveB.classList.add('inline-flex');
          } else {
            liveB.classList.add('hidden');
            liveB.classList.remove('inline-flex');
          }
        }
        renderSeatLayoutCoachTabs();
        renderActiveCoachCarriage();
        syncSeatLayoutSourceBadges();
      } else {
        if (!json || (!json.data?.coaches?.length && !json.data?.seatLayout && !json.seatLayout)) {
          currentSeatLayoutState.isLive = false;
          renderActiveCoachCarriage();
          syncSeatLayoutSourceBadges();
        }
      }
    } catch (e) {
      console.warn('[SeatLayout] Coach class live-coach-layout fetch error:', e.message);
      if (liveSearchBadge) { liveSearchBadge.classList.add('hidden'); liveSearchBadge.classList.remove('inline-flex'); }
      if (currentSeatLayoutState) {
        currentSeatLayoutState.isLive = false;
        renderActiveCoachCarriage();
      }
    } finally {
      clearTimeout(classWatchdog);
      // Always clear the fetching flag, so the spinner cannot get stuck when a
      // request fails or returns nothing usable.
      if (currentSeatLayoutState) {
        currentSeatLayoutState.fetching = false;
        syncSeatLayoutSourceBadges();
      }
    }
  }

  // Single source of truth for the modal's provenance badges and subtitle.
  // The map is only presented as "live" when EVERY coach on screen came from the
  // official per-seat endpoint; a rake that mixes live and template coaches is
  // still not fully live, and saying otherwise would misrepresent the data.
  function syncSeatLayoutSourceBadges() {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const st = currentSeatLayoutState || {};
    const coaches = st.coaches || [];
    const allLive = coaches.length > 0 && coaches.every(c => c.status_source === 'official_railway_server' || c.status_source === 'official_railway_mobile_app');
    const isLive = !!st.isLive && allLive;

    const setBadge = (el, on) => {
      if (!el) return;
      el.classList.toggle('hidden', !on);
      el.classList.toggle('inline-flex', on);
    };

    setBadge(document.getElementById('seatLayoutLiveBadge'), isLive);
    setBadge(document.getElementById('seatLayoutTemplateBadge'), !isLive);
    setBadge(document.getElementById('seatLayoutQuickSyncBtn'), !isLive && !st.fetching);
    setBadge(document.getElementById('seatLayoutSearchingBadge'), !!st.fetching);

    const isSocketConnected = !!(activeSeatLayoutWebSocket && activeSeatLayoutWebSocket.readyState === WebSocket.OPEN);
    setBadge(document.getElementById('seatLayoutSocketBadge'), isSocketConnected);
    const socketBadgeText = document.querySelector('#seatLayoutSocketBadge span:last-child');
    if (socketBadgeText) {
      socketBadgeText.textContent = isBn ? 'লাইভ স্ট্রিম' : 'Live Stream';
    }

    const sub = document.getElementById('seatLayoutSubtitle');
    if (sub) {
      if (isLive) {
        sub.textContent = isBn
          ? 'লাইভ ক্যারেজ লেআউট — বাংলাদেশ রেলওয়ে শোহোজ API থেকে সরাসরি'
          : 'Live carriage layout direct from Bangladesh Railway Shohoz API';
      } else {
        sub.textContent = isBn
          ? 'অফিসিয়াল বাংলাদেশ রেলওয়ে বগির কাঠামো — ব্যাকগ্রাউন্ডে স্বয়ংক্রিয়ভাবে লাইভ সিঙ্ক হচ্ছে'
          : 'Official Bangladesh Railway coach layout — Auto-syncing live seat status in background';
      }
    }
  }

  // -------------------------------------------------------------------------
  // 1-Second Quick-Sync Live Token Trigger
  // Solves Cloudflare Turnstile on Railway in <1s via micro-collector & updates layout
  // -------------------------------------------------------------------------
  let isQuickSyncInProgress = false;

  function triggerOneSecondQuickSync(onSuccess) {
    if (isQuickSyncInProgress) return;
    isQuickSyncInProgress = true;
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    showToast(isBn ? '⚡ ১-সেকেন্ড কুইক-সিঙ্ক সক্রিয়! লাইভ টোকেন সংগ্রহ হচ্ছে...' : '⚡ 1-Sec Quick-Sync active! Grabbing fresh Railway verification token...', 'info');

    const syncUrl = 'https://eticket.railway.gov.bd/login?cft_collector=1';
    let popup = null;
    try {
      popup = window.open(syncUrl, 'railseat_quick_sync', 'width=450,height=550,top=120,left=120');
    } catch (e) {}

    let attempts = 0;
    const pollInterval = setInterval(async () => {
      attempts++;
      try {
        let freshToken = window._freshBridgeCft || '';
        if (!freshToken) {
          const res = await fetch('/api/auth/token-status');
          if (res.ok) {
            const data = await res.json();
            if (data.has_cft && data.cft_age_seconds !== null && data.cft_age_seconds < 30) {
              freshToken = data.cft_response;
            }
          }
        }

        if (freshToken) {
          clearInterval(pollInterval);
          isQuickSyncInProgress = false;
          try { if (popup && !popup.closed) popup.close(); } catch (e) {}
          showToast(isBn ? '🎯 ১০০% লাইভ রেলওয়ে টোকেন সিঙ্ক সম্পন্ন!' : '🎯 100% Genuine Live Railway Token Synced!', 'success');

          // If seat layout modal is currently open, immediately re-fetch live layout
          if (currentSeatLayoutState && currentSeatLayoutState.tripId) {
            fetchClassLiveSeatLayout(currentSeatLayoutState.lastFetchedClass || 'S_CHAIR');
          }

          if (typeof onSuccess === 'function') onSuccess(freshToken);
        }
      } catch (e) {}

      if (attempts >= 30) {
        clearInterval(pollInterval);
        isQuickSyncInProgress = false;
      }
    }, 250);
  }

  // Cross-window message listener for instant token delivery from popup
  window.addEventListener('message', async (e) => {
    if (e.data && e.data.type === 'RAILSEAT_CFT_TOKEN' && e.data.cft_response) {
      console.log('[QuickSync] Instant token arrived via postMessage:', e.data.cft_response.substring(0, 16));
      window._freshBridgeCft = e.data.cft_response;
      try {
        await fetch('/api/auth/set-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cft_response: e.data.cft_response })
        });
      } catch (err) {}
    }
  });

  // Attach button click listeners
  const headerQuickSyncBtn = document.getElementById('headerQuickSyncBtn');
  if (headerQuickSyncBtn) {
    headerQuickSyncBtn.addEventListener('click', () => triggerOneSecondQuickSync());
  }
  const seatLayoutQuickSyncBtn = document.getElementById('seatLayoutQuickSyncBtn');
  if (seatLayoutQuickSyncBtn) {
    seatLayoutQuickSyncBtn.addEventListener('click', () => triggerOneSecondQuickSync());
  }

  function renderSeatLayoutCoachTabs() {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const coaches = currentSeatLayoutState?.coaches || [];
    const allCoaches = currentSeatLayoutState?.allCoaches || coaches;
    const isAvailOnly = currentSeatLayoutState?.availableOnly !== false;

    syncSeatLayoutSourceBadges();

    // Sync toggle button appearance
    const availToggle = document.getElementById('seatLayoutAvailableOnlyToggle');
    const availToggleText = document.getElementById('seatLayoutAvailableOnlyToggleText');
    if (availToggle && availToggleText) {
      if (isAvailOnly && allCoaches.length > coaches.length) {
        availToggle.className = 'inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:opacity-90 transition cursor-pointer shadow-xs';
        availToggleText.textContent = isBn ? `শুধু খালি বগি (${coaches.length})` : `Available Only (${coaches.length}/${allCoaches.length})`;
        availToggle.title = isBn ? 'সকল বগি দেখতে ক্লিক করুন' : 'Click to show all coaches';
      } else if (!isAvailOnly) {
        availToggle.className = 'inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:opacity-90 transition cursor-pointer';
        availToggleText.textContent = isBn ? `সকল বগি (${allCoaches.length})` : `All Coaches (${allCoaches.length})`;
        availToggle.title = isBn ? 'শুধু খালি বগি দেখতে ক্লিক করুন' : 'Click to show only coaches with available seats';
      } else {
        availToggle.className = 'inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:opacity-90 transition cursor-pointer shadow-xs';
        availToggleText.textContent = isBn ? `শুধু খালি বগি (${coaches.length})` : `Available Only (${coaches.length})`;
      }
    }

    if (seatLayoutCoachesSummary) {
      // Only total up availability the server actually reported. Unknown
      // coaches are counted separately instead of being read as zero.
      const known = coaches.filter(c => c.available_seats !== null && c.available_seats !== undefined);
      const totalAvail = known.reduce((sum, c) => sum + Number(c.available_seats || 0), 0);
      const totalSeats = coaches.reduce((sum, c) => sum + Number(c.total_seats || 0), 0);
      const arr = isBn ? window.i18n.toBnNum : (v) => v;
      if (isAvailOnly && allCoaches.length > coaches.length) {
        seatLayoutCoachesSummary.textContent = isBn
          ? `${arr(coaches.length)}টি খালি বগি (মোট ${arr(allCoaches.length)}) • খালি: ${arr(totalAvail)}টি সিট`
          : `${coaches.length} Available Coaches (${allCoaches.length} total) • ${totalAvail} seats available`;
      } else {
        seatLayoutCoachesSummary.textContent = isBn
          ? `${arr(coaches.length)}টি বগি • মোট খালি: ${arr(totalAvail)}টি সিট • মোট আসন: ${arr(totalSeats)}`
          : `${coaches.length} Coaches • ${totalAvail} of ${totalSeats} seats available`;
      }
    }

    if (!seatLayoutCoachTabs) return;
    const isFetching = !!currentSeatLayoutState?.fetching;

    if (coaches.length === 0) {
      if (isFetching) {
        seatLayoutCoachTabs.innerHTML = `
          <div class="py-1 px-3 text-xs text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-2 whitespace-nowrap animate-pulse">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>${isBn ? 'রেলওয়ে সার্ভার থেকে লাইভ বগি লোড হচ্ছে...' : 'Loading live carriages from Railway server...'}</span>
          </div>
        `;
      } else {
        seatLayoutCoachTabs.innerHTML = `
          <div class="py-1 px-3 text-xs text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1.5 whitespace-nowrap">
            <i class="fa-solid fa-circle-exclamation text-amber-500"></i>
            <span>${isBn ? 'এই ট্রেনের কোনো বগিতে খালি আসন নেই' : 'No coaches with available seats found on this train (Sold Out)'}</span>
          </div>
        `;
      }
      return;
    }

    seatLayoutCoachTabs.innerHTML = coaches.map((c, idx) => {
      const isActive = idx === currentSeatLayoutState.activeCoachIndex;
      const isLive = c.status_source === 'official_railway_server' || c.status_source === 'official_railway_mobile_app';
      const availKnown = c.available_seats !== null && c.available_seats !== undefined;
      const availCount = availKnown ? Number(c.available_seats || 0) : null;
      const isAvail = availCount !== null && availCount > 0;
      const countDisplay = availKnown
        ? (isBn ? window.i18n.toBnNum(availCount) : availCount)
        : '?';
      const totalSeats = Number(c.total_seats || 0);
      const countTitle = availKnown
        ? (isBn ? `মোট ${window.i18n.toBnNum(totalSeats)}টির মধ্যে ${window.i18n.toBnNum(availCount)}টি খালি` : `${availCount} available of ${totalSeats} seats`)
        : (isBn ? 'সিটের অবস্থা এখনো যাচাই হয়নি' : 'Per-seat status not verified yet');

      return `
        <button type="button" class="coach-tab-pill px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 transition flex items-center space-x-1.5 cursor-pointer ${
          isActive 
            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' 
            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500'
        }" data-coach-index="${idx}" title="${countTitle}">
          <span class="tracking-tight">${c.coach_name || `Coach ${idx + 1}`}</span>
          <span class="px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${
            isActive 
              ? 'bg-emerald-700 text-white' 
              : (!availKnown
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                  : (isAvail ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'))
          }">
            ${countDisplay}
          </span>
        </button>
      `;
    }).join('');

    seatLayoutCoachTabs.querySelectorAll('.coach-tab-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.coachIndex, 10);
        if (!isNaN(idx) && idx !== currentSeatLayoutState.activeCoachIndex) {
          currentSeatLayoutState.activeCoachIndex = idx;
          currentSeatLayoutState.selectedSeat = null;
          currentSeatLayoutState.selectedSeats = [];
          renderSeatLayoutCoachTabs();
          renderActiveCoachCarriage();
        }
      });
    });
  }

  function toggleAvailableOnlyCoaches() {
    if (!currentSeatLayoutState) return;
    const all = currentSeatLayoutState.allCoaches || currentSeatLayoutState.coaches || [];
    currentSeatLayoutState.availableOnly = !currentSeatLayoutState.availableOnly;

    const availableCoaches = all.filter(isCoachAvailable);
    if (currentSeatLayoutState.availableOnly) {
      currentSeatLayoutState.coaches = availableCoaches.length > 0 ? availableCoaches : all;
    } else {
      currentSeatLayoutState.coaches = all;
    }

    if (currentSeatLayoutState.activeCoachIndex >= currentSeatLayoutState.coaches.length) {
      currentSeatLayoutState.activeCoachIndex = 0;
    }
    currentSeatLayoutState.selectedSeat = null;
    currentSeatLayoutState.selectedSeats = [];
    renderSeatLayoutCoachTabs();
    renderActiveCoachCarriage();
  }

  function buildExactSeatBookingUrl(mode = 'buy') {
    const st = currentSeatLayoutState;
    if (!st) return 'https://eticket.railway.gov.bd';
    const coach = st.coaches?.[st.activeCoachIndex];
    const bookClass = coach?.seat_class || st.lastFetchedClass || 'S_CHAIR';
    const selectedSeats = Array.isArray(st.selectedSeats) ? st.selectedSeats : [];
    const baseBookingUrl = buildShohozBookingUrl(st.fromCity, st.toCity, st.journeyDate, bookClass);

    const coachName = coach?.coach_name || selectedSeats[0]?.coach_name || '';
    const seatNumbersOnly = selectedSeats.map(s => s.seat_number ? String(s.seat_number).replace(/^[^-]+-/, '') : s.seat_name);
    const seatNamesStr = seatNumbersOnly.join(',');

    // Authoritative Train Identity from live data
    const effectiveTrainName = st.targetTrain?.train_name || st.trainName || '';
    const rawTrainModel = String(st.targetTrain?.train_model || st.trainModel || '');
    const effectiveTrainModel = rawTrainModel.replace(/\D/g, '') || rawTrainModel.trim();

    // Only pass real numeric trip IDs (avoid placeholder 'TRIP_701')
    const rawTripId = String(coach?.trip_id || st.tripId || '');
    const rawTripRouteId = String(coach?.trip_route_id || st.tripRouteId || '');
    const coachTripId = (/^\d+$/.test(rawTripId)) ? rawTripId : '';
    const coachTripRouteId = (/^\d+$/.test(rawTripRouteId)) ? rawTripRouteId : '';

    try {
      const urlObj = new URL(baseBookingUrl);
      if (effectiveTrainName) urlObj.searchParams.set('train', effectiveTrainName);
      if (effectiveTrainModel) urlObj.searchParams.set('train_model', effectiveTrainModel);
      if (coachName) urlObj.searchParams.set('coach', coachName);
      if (seatNamesStr) {
        urlObj.searchParams.set('seats', seatNamesStr);
        urlObj.searchParams.set('seats_count', String(selectedSeats.length));
      } else {
        urlObj.searchParams.set('seats_count', '1');
      }
      urlObj.searchParams.set('autobook', '1');
      if (coachName) urlObj.searchParams.set('exact_coach', '1');
      if (coachTripId) urlObj.searchParams.set('trip_id', coachTripId);
      if (coachTripRouteId) urlObj.searchParams.set('trip_route_id', coachTripRouteId);

      if (mode === 'hold') {
        urlObj.searchParams.set('hold_only', '1');
      }
      return urlObj.toString();
    } catch (e) {
      const holdParam = mode === 'hold' ? '&hold_only=1' : '';
      const coachParam = coachName ? `&coach=${encodeURIComponent(coachName)}&exact_coach=1` : '';
      const seatParam = seatNamesStr ? `&seats=${encodeURIComponent(seatNamesStr)}&seats_count=${selectedSeats.length}` : '&seats_count=1';
      return `${baseBookingUrl}&train=${encodeURIComponent(effectiveTrainName)}&train_model=${encodeURIComponent(effectiveTrainModel)}${coachParam}${seatParam}&autobook=1${holdParam}`;
    }
  }

  function saveExactSeatIntent(mode = 'buy') {
    const st = currentSeatLayoutState;
    if (!st) return;
    const coach = st.coaches?.[st.activeCoachIndex];
    const bookClass = coach?.seat_class || st.lastFetchedClass || 'S_CHAIR';
    const selectedSeats = Array.isArray(st.selectedSeats) ? st.selectedSeats : [];
    const coachName = coach?.coach_name || selectedSeats[0]?.coach_name || '';
    const seatNumbersOnly = selectedSeats.map(s => s.seat_number ? String(s.seat_number).replace(/^[^-]+-/, '') : s.seat_name);

    const effectiveTrainName = st.targetTrain?.train_name || st.trainName || '';
    const rawTrainModel = String(st.targetTrain?.train_model || st.trainModel || '');
    const effectiveTrainModel = rawTrainModel.replace(/\D/g, '') || rawTrainModel.trim();

    const rawTripId = String(coach?.trip_id || st.tripId || '');
    const rawTripRouteId = String(coach?.trip_route_id || st.tripRouteId || '');
    const coachTripId = (/^\d+$/.test(rawTripId)) ? rawTripId : '';
    const coachTripRouteId = (/^\d+$/.test(rawTripRouteId)) ? rawTripRouteId : '';

    const intent = {
      train: effectiveTrainName,
      trainModel: effectiveTrainModel,
      seatClass: bookClass,
      coach: coachName,
      seats: seatNumbersOnly,
      seatsCount: selectedSeats.length || 1,
      exactCoach: !!coachName,
      from: st.fromCity || '',
      to: st.toCity || '',
      doj: st.journeyDate || '',
      holdOnly: mode === 'hold',
      tripId: coachTripId,
      tripRouteId: coachTripRouteId,
      createdAt: Date.now()
    };

    try {
      sessionStorage.setItem('railseat_autobook_intent', JSON.stringify(intent));
      localStorage.setItem('railseat_autobook_intent', JSON.stringify(intent));
    } catch (e) {}
  }

  function updateSeatLayoutBookNowButton() {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const st = currentSeatLayoutState;
    if (!st) return;

    const coach = st.coaches?.[st.activeCoachIndex];
    const selectedSeats = Array.isArray(st.selectedSeats) ? st.selectedSeats : [];
    const hasSeats = selectedSeats.length > 0;

    const holdUrl = buildExactSeatBookingUrl('hold');
    const buyUrl = buildExactSeatBookingUrl('buy');

    if (seatLayoutHoldBtn) seatLayoutHoldBtn.href = holdUrl;
    if (seatLayoutBuyBtn) seatLayoutBuyBtn.href = buyUrl;
    if (seatLayoutBookNowBtn) seatLayoutBookNowBtn.href = buyUrl;

    if (seatLayoutAutoBookHint) {
      seatLayoutAutoBookHint.classList.add('hidden');
    }

    if (!hasSeats) {
      if (seatLayoutHoldText) {
        seatLayoutHoldText.textContent = isBn ? 'সিট হোল্ড' : 'Hold Only';
      }
      if (seatLayoutBuyText) {
        seatLayoutBuyText.textContent = isBn ? 'এখনই কিনুন' : 'Buy Now';
      }
      if (seatLayoutBookNowText) {
        seatLayoutBookNowText.textContent = isBn ? 'রেলওয়ে সাইটে টিকিট কাটুন' : 'Book on Railway';
      }
      return;
    }

    const fallbackFare = Number(coach?.fare || st.targetFare || 0);
    const totalFare = selectedSeats.reduce((sum, s) => sum + (Number(s.fare) || fallbackFare || 0), 0);
    const count = selectedSeats.length;
    const coachName = coach?.coach_name || selectedSeats[0]?.coach_name || '';
    const seatNamesOnly = selectedSeats.map(s => s.seat_number ? String(s.seat_number).replace(/^[^-]+-/, '') : s.seat_name);
    const seatNamesJoined = seatNamesOnly.join(', ');

    const countBn = isBn && window.i18n ? window.i18n.toBnNum(count) : count;
    const fareBn = isBn && window.i18n ? window.i18n.toBnNum(totalFare) : totalFare;
    const seatNamesBn = isBn && window.i18n ? window.i18n.toBnNum(seatNamesJoined) : seatNamesJoined;
    const coachBn = isBn && window.i18n ? window.i18n.toBnNum(coachName) : coachName;

    if (seatLayoutHoldText) {
      if (isBn) {
        seatLayoutHoldText.textContent = `হোল্ড (${coachBn}-${seatNamesBn})`;
      } else {
        seatLayoutHoldText.textContent = `Hold (${coachName}-${seatNamesJoined})`;
      }
    }

    if (seatLayoutBuyText) {
      if (isBn) {
        seatLayoutBuyText.textContent = `কিনুন • ৳${fareBn}`;
      } else {
        seatLayoutBuyText.textContent = `Buy Now • ৳${totalFare}`;
      }
    }

    if (seatLayoutBookNowText) {
      if (isBn) {
        seatLayoutBookNowText.textContent = `${countBn}টি সিট কাটুন (${coachBn}-${seatNamesBn}) • ৳${fareBn}`;
      } else {
        seatLayoutBookNowText.textContent = `Book ${count} Seat${count > 1 ? 's' : ''} (${coachName}-${seatNamesJoined}) • ৳${totalFare}`;
      }
    }

    if (seatLayoutAutoBookHintText) {
      seatLayoutAutoBookHintText.textContent = '';
    }
  }

  function renderActiveCoachCarriage() {
    const isBn = window.i18n && window.i18n.getLang() === 'bn';
    const st = currentSeatLayoutState;
    if (!st || !seatLayoutContent) return;

    // Strict Live Enforcement: Show live spinner while fetching and reset banner stats
    if (st.fetching) {
      if (seatLayoutActiveCoachName) seatLayoutActiveCoachName.textContent = '--';
      if (seatLayoutActiveCoachClass) seatLayoutActiveCoachClass.textContent = st.lastFetchedClass || '--';
      if (seatLayoutActiveTotalCount) seatLayoutActiveTotalCount.textContent = '--';
      if (seatLayoutActiveBookedCount) seatLayoutActiveBookedCount.textContent = '--';
      if (seatLayoutActiveAvailCount) seatLayoutActiveAvailCount.textContent = '--';
      if (seatLayoutActiveFare) seatLayoutActiveFare.textContent = '--';

      seatLayoutContent.innerHTML = `
        <div class="py-16 flex flex-col items-center justify-center space-y-4 text-center">
          <div class="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-2xl shadow-sm border border-emerald-200 dark:border-emerald-800">
            <svg class="w-7 h-7 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
            </svg>
          </div>
          <div class="space-y-1.5 max-w-sm">
            <h4 class="font-black text-base text-slate-800 dark:text-white">
              ${isBn ? 'রেলওয়ে সার্ভার থেকে ১০০% লাইভ সিটম্যাপ আনা হচ্ছে...' : 'Fetching 100% Live Seat Map from Railway Server...'}
            </h4>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              ${isBn ? 'কোনো ক্যাশ বা অনুমানকৃত সিট দেখানো হয় না। শুধুমাত্র বাংলাদেশ রেলওয়ের আসল লাইভ সিট লোড হচ্ছে।' : 'Cached and simulated seat maps are disabled. Loading 100% verified real-time seat availability directly from Bangladesh Railway.'}
            </p>
          </div>
          <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span>${isBn ? 'লাইভ সার্ভার কানেকশন সক্রিয়...' : 'Live Railway Connection Active...'}</span>
          </div>
        </div>
      `;
      return;
    }

    // Render coach seats whenever coaches exist; only show retry state if no coach data loaded
    if (!st.coaches || st.coaches.length === 0) {
      seatLayoutContent.innerHTML = `
        <div class="py-14 max-w-md mx-auto text-center space-y-4 px-4">
          <div class="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-2xl shadow-sm border border-emerald-200 dark:border-emerald-800">
            <i class="fa-solid fa-satellite-dish animate-pulse"></i>
          </div>
          <div class="space-y-1.5">
            <h4 class="font-extrabold text-base text-slate-900 dark:text-white">
              ${isBn ? 'লাইভ সিটম্যাপ সংযোগ স্থাপন করা হচ্ছে...' : 'Connecting to Live Railway Seat Map...'}
            </h4>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              ${isBn ? 'ক্যাশ সিটম্যাপ বন্ধ রাখা হয়েছে। রেলওয়ে সার্ভার থেকে ১০০% লাইভ আসন তালিকা সংগ্রহ করা হচ্ছে।' : 'Cached seat maps are disabled. Retrieving 100% genuine live seats directly from official Railway server...'}
            </p>
          </div>
          <div class="pt-2">
            <button type="button" id="btnLiveRetryNow" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md transition flex items-center justify-center gap-2 mx-auto cursor-pointer">
              <i class="fa-solid fa-bolt"></i>
              <span>${isBn ? 'লাইভ সিটম্যাপ রিফ্রেশ করুন' : 'Retry Live Seat Map'}</span>
            </button>
          </div>
        </div>
      `;
      const btnRetry = seatLayoutContent.querySelector('#btnLiveRetryNow');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => {
          st.fetching = true;
          renderActiveCoachCarriage();
          requestBackgroundTurnstileToken(true);
          fetchClassLiveSeatLayout(st.lastFetchedClass || 'S_CHAIR');
        });
      }
      requestBackgroundTurnstileToken(false);
      return;
    }

    const coach = st.coaches?.[st.activeCoachIndex];
    if (!coach) {
      seatLayoutContent.innerHTML = `
        <div class="py-12 max-w-md mx-auto text-center space-y-3 px-4">
          <div class="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto text-xl border border-amber-200 dark:border-amber-800">
            <i class="fa-solid fa-chair"></i>
          </div>
          <h4 class="font-extrabold text-sm sm:text-base text-slate-800 dark:text-white">
            ${isBn ? 'এই ট্রেনের কোনো বগিতে খালি আসন নেই' : 'No Coaches With Available Seats'}
          </h4>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            ${isBn ? 'সবগুলো আসন ইতোমধ্যে বুকড হয়ে গেছে। অন্য ট্রেন বা তারিখ অনুসন্ধান করুন।' : 'All seats on this train are currently booked. Please check another train or travel date.'}
          </p>
        </div>
      `;
      return;
    }

    const coachClass = coach.seat_class || 'S_CHAIR';
    const classDisplayName = window.i18n ? window.i18n.getSeatClassName(coachClass) : coachClass;
    if (seatLayoutClassBadge) seatLayoutClassBadge.textContent = coachClass;
    if (seatLayoutActiveCoachName) seatLayoutActiveCoachName.textContent = coach.coach_name || '--';
    if (seatLayoutActiveCoachClass) seatLayoutActiveCoachClass.textContent = classDisplayName;

    const fmtCount = (v) => {
      if (v === null || v === undefined) return isBn ? '--' : '--';
      return isBn ? window.i18n.toBnNum(v) : String(v);
    };

    const totalSeats = (coach.total_seats !== undefined && coach.total_seats !== null) 
      ? coach.total_seats 
      : ((coach.seats && coach.seats.length) ? coach.seats.length : ((Number(coach.available_seats) || 0) + (Number(coach.booked_seats) || 0)));

    if (seatLayoutActiveTotalCount) seatLayoutActiveTotalCount.textContent = fmtCount(totalSeats);
    if (seatLayoutActiveAvailCount) seatLayoutActiveAvailCount.textContent = fmtCount(coach.available_seats);
    if (seatLayoutActiveBookedCount) seatLayoutActiveBookedCount.textContent = fmtCount(coach.booked_seats);
    if (seatLayoutActiveFare) {
      const fareVal = coach.fare || (coach.seats?.[0]?.total_fare) || (coach.seats?.[0]?.fare) || currentSeatLayoutState.targetFare || 0;
      seatLayoutActiveFare.textContent = fareVal ? (isBn ? `৳${window.i18n.toBnNum(fareVal)}` : `৳${fareVal}`) : '--';
    }

    updateSeatLayoutBookNowButton();

    if (!seatLayoutContent) return;



    const seats = coach.seats || [];
    if (seats.length === 0) {
      seatLayoutContent.innerHTML = `
        <div class="py-12 text-center text-slate-400">
          <p class="text-xs font-semibold">${isBn ? 'এই বগিতে কোনো সিটের তথ্য পাওয়া যায়নি।' : 'No seat details found for this coach.'}</p>
        </div>
      `;
      return;
    }

    // Extract exact rows from railway server or structured template
    let rowsList = [];
    if (coach.layout && Array.isArray(coach.layout.rows) && coach.layout.rows.length > 0) {
      rowsList = coach.layout.rows;
    } else {
      const rowMap = new Map();
      seats.forEach(s => {
        const r = (s.row !== undefined && s.row !== null) ? s.row : 1;
        if (!rowMap.has(r)) rowMap.set(r, []);
        rowMap.get(r).push(s);
      });
      rowsList = Array.from(rowMap.values());
    }

    const gridCols = Math.max(1, coach.layout?.grid_columns || (rowsList[0]?.length) || 5);

    const STATUS_LABEL = isBn
      ? { available: 'খালি', booked: 'বুকড', process: 'বুকিং চলমান', unknown: 'অজানা', blank: 'ফাঁকা' }
      : { available: 'Available', booked: 'Booked', process: 'In Process', unknown: 'Status unknown', blank: 'Blank seat' };

    const renderSeatTile = (s) => {
      // In layout show blank instead of box where no seat position
      if (!s || s.is_blank || s.status === 'blank' || !s.seat_number) {
        return `<div class="aspect-square w-full pointer-events-none"></div>`;
      }

      const isAvail = s.status === 'available';
      const isProcess = s.status === 'booking-in-process';
      const isBooked = s.status === 'booked';
      const isUnknown = !isAvail && !isProcess && !isBooked;

      const fullSeatName = s.full_seat_name || s.seat_name || (coach.coach_name + '-' + s.seat_number);
      const isSelected = Array.isArray(currentSeatLayoutState.selectedSeats) &&
        currentSeatLayoutState.selectedSeats.some(sel =>
          sel.seat_name === fullSeatName ||
          sel.seat_name === s.seat_name ||
          (sel.coach_name === coach.coach_name && String(sel.seat_number) === String(s.seat_number))
        );

      // Extract short clean display number e.g. 1, 2, 3 instead of CHA-1
      const coachPrefixRegex = new RegExp('^' + (coach.coach_name || '') + '[-_]', 'i');
      let numDisplay = String(s.display_number || s.seat_number || '').replace(coachPrefixRegex, '');
      if (isBn && window.i18n) {
        numDisplay = window.i18n.toBnNum(numDisplay);
      }

      const isWindow = !!s.is_window;
      const windowBar = isWindow 
        ? `<span class="w-3/5 h-[2.5px] rounded-full bg-slate-700 dark:bg-slate-300 mt-0.5"></span>` 
        : '';

      let tileClasses = '';
      if (isSelected) {
        tileClasses = 'bg-amber-500 text-white border-2 border-amber-600 shadow-md ring-2 ring-amber-300 font-black cursor-pointer transform scale-105';
      } else if (isAvail) {
        tileClasses = 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-2 border-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 font-extrabold cursor-pointer shadow-2xs hover:scale-105';
      } else if (isProcess) {
        tileClasses = 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-2 border-amber-500 dark:border-amber-400 cursor-not-allowed font-extrabold ring-2 ring-amber-300/60 dark:ring-amber-500/30 animate-pulse';
      } else if (isBooked) {
        tileClasses = 'bg-[#f0eee9] dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border border-[#e2ded6] dark:border-slate-700/60 cursor-not-allowed line-through text-[11px]';
      } else {
        tileClasses = 'bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-700 cursor-not-allowed';
      }

      const processBadge = isProcess 
        ? `<span class="text-[8px] text-amber-600 dark:text-amber-400 font-black leading-none mt-0.5 animate-bounce"><i class="fa-regular fa-clock"></i></span>`
        : '';

      return `
        <button type="button" class="carriage-seat-btn aspect-square w-full rounded sm:rounded-md flex flex-col items-center justify-center p-0 transition duration-150 select-none ${tileClasses}"
          data-seat-name="${fullSeatName}" data-seat-number="${s.seat_number}" data-seat-status="${s.status}" data-seat-fare="${s.total_fare || s.fare || coach.fare || 0}"
          title="${fullSeatName} (${STATUS_LABEL[isAvail ? 'available' : (isBooked ? 'booked' : (isProcess ? 'process' : 'unknown'))]}${isWindow ? ' • Window' : ''}${isProcess ? ' • Locked in 5-min checkout' : ''})">
          <span class="text-[10px] sm:text-[11px] font-bold leading-none tracking-tight seat-number-text">${numDisplay}</span>
          ${processBadge}
          ${windowBar}
        </button>
      `;
    };

    const rowsHtml = rowsList.map((rowSeats) => {
      const rowCols = rowSeats.map(s => renderSeatTile(s)).join('');
      return `<div class="grid gap-1 sm:gap-1.5 items-center" style="grid-template-columns: repeat(${gridCols}, minmax(0, 1fr))">${rowCols}</div>`;
    }).join('');

    const unknownCount = seats.filter(s => s.status === 'unknown').length;
    let statusNotice = '';
    if (unknownCount > 0 && !isLive) {
      statusNotice = `
        <div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border border-emerald-300/60 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-[11px] text-emerald-800 dark:text-emerald-300 max-w-[300px] mx-auto mb-1">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span class="font-semibold">${isBn ? 'ব্যাকগ্রাউন্ডে লাইভ সিট সিঙ্ক হচ্ছে...' : 'Auto-syncing live seat status...'}</span>
          </div>
          <span class="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">100% Auto</span>
        </div>
      `;
    }

    const isLive = coach.status_source === 'official_railway_server' || coach.status_source === 'official_railway_mobile_app';
    const totalPhysicalSeats = coach.total_seats || seats.filter(s => !s.is_blank && s.seat_number).length;
    const availCount = (coach.available_seats !== null && coach.available_seats !== undefined) ? coach.available_seats : seats.filter(s => s.status === 'available').length;
    const countDisplay = isBn ? `${window.i18n.toBnNum(availCount)}/${window.i18n.toBnNum(totalPhysicalSeats)} খালি` : `${availCount}/${totalPhysicalSeats} free`;

    const carriageHtml = `
      ${statusNotice}
      
      <!-- Top Legend matching railway reference -->
      <div class="flex items-center justify-center gap-3.5 text-xs text-slate-600 dark:text-slate-300 pb-1.5">
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded border-2 border-emerald-600 bg-white dark:bg-slate-800 inline-block"></span>
          <span class="font-medium text-[11px]">${isBn ? 'খালি' : 'Free'}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded bg-amber-500 border border-amber-600 inline-block"></span>
          <span class="font-medium text-[11px]">${isBn ? 'বাছাইকৃত' : 'Selected'}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded bg-[#f0eee9] dark:bg-slate-800 border border-[#e2ded6] dark:border-slate-700 inline-block"></span>
          <span class="font-medium text-[11px]">${isBn ? 'বুকড' : 'Taken'}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 inline-block"></span>
          <span class="font-medium text-[11px]">${isBn ? 'বুকিং চলমান' : 'In Process'}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-3.5 h-3.5 rounded border border-slate-400 dark:border-slate-600 border-b-[3px] border-b-slate-700 dark:border-b-slate-300 inline-block"></span>
          <span class="font-medium text-[11px]">${isBn ? 'জানালা' : 'Window'}</span>
        </div>
      </div>

      <!-- Compact Coach Card (Direct Railway Style) -->
      <div class="w-full max-w-[280px] sm:max-w-[300px] mx-auto bg-[#fbf9f5] dark:bg-slate-900 rounded-2xl border border-[#e8e4dc] dark:border-slate-800 p-2.5 sm:p-3 shadow-xs space-y-2">
        
        <!-- Coach Card Header -->
        <div class="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-1.5">
          <div class="flex items-center space-x-1.5">
            <span class="text-sm sm:text-base font-black text-slate-800 dark:text-white tracking-tight">${coach.coach_name || 'Coach'}</span>
            ${isLive ? '<span class="px-1.5 py-0.5 rounded bg-slate-900 text-white dark:bg-emerald-600 text-[9px] font-extrabold uppercase tracking-wider">PICK</span>' : '<span class="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-300/60 dark:border-amber-800/60 text-[9px] font-bold tracking-wider inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>' + (isBn ? 'সিঙ্ক হচ্ছে...' : 'SYNCING...') + '</span>'}
          </div>
          <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400">${countDisplay}</span>
        </div>

        <!-- Seating Plan Rows -->
        <div class="space-y-1 sm:space-y-1.5 py-0.5">
          ${rowsHtml}
        </div>

      </div>
    `;

    seatLayoutContent.innerHTML = carriageHtml;

    seatLayoutContent.querySelectorAll('.carriage-seat-btn[data-seat-name]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.seatStatus !== 'available') return;
        const seatName = btn.dataset.seatName;
        const seatNumber = btn.dataset.seatNumber;
        const fare = Number(btn.dataset.seatFare) || Number(coach.fare) || 0;
        const coachName = coach.coach_name || '';

        if (!Array.isArray(currentSeatLayoutState.selectedSeats)) {
          currentSeatLayoutState.selectedSeats = [];
        }

        const existingIdx = currentSeatLayoutState.selectedSeats.findIndex(sel =>
          sel.seat_name === seatName ||
          (sel.coach_name === coachName && String(sel.seat_number) === String(seatNumber))
        );

        if (existingIdx !== -1) {
          // Deselect / toggle off
          currentSeatLayoutState.selectedSeats.splice(existingIdx, 1);
        } else {
          // Validate max 4 seats rule of Bangladesh Railway
          if (currentSeatLayoutState.selectedSeats.length >= 4) {
            const limitMsg = (window.i18n && window.i18n.getLang() === 'bn')
              ? 'সর্বোচ্চ ৪টি আসন নির্বাচন করা যাবে।'
              : 'Maximum 4 seats can be selected per booking.';
            showToast(limitMsg, 'info');
            return;
          }
          currentSeatLayoutState.selectedSeats.push({
            seat_name: seatName,
            seat_number: seatNumber,
            coach_name: coachName,
            fare: fare
          });
        }

        // Keep legacy property in sync
        currentSeatLayoutState.selectedSeat = currentSeatLayoutState.selectedSeats[currentSeatLayoutState.selectedSeats.length - 1] || null;

        renderActiveCoachCarriage();
      });
    });
  }

  // ----------------------------------------------------
  // User Management & Access Control Module
  // ----------------------------------------------------
  let cachedUsersList = [];

  function getAuthToken() {
    return localStorage.getItem('rail_auth_token') || sessionStorage.getItem('rail_auth_token') || '';
  }

  function setAuthToken(token, remember = true) {
    if (token) {
      if (remember) {
        localStorage.setItem('rail_auth_token', token);
        sessionStorage.removeItem('rail_auth_token');
      } else {
        sessionStorage.setItem('rail_auth_token', token);
        localStorage.removeItem('rail_auth_token');
      }
    } else {
      localStorage.removeItem('rail_auth_token');
      sessionStorage.removeItem('rail_auth_token');
    }
  }

  function openLoginModal() {
    if (!userLoginModal) return;
    const rememberedUser = localStorage.getItem('rail_remembered_username');
    if (rememberedUser && loginUsername) {
      loginUsername.value = rememberedUser;
      if (loginRememberMe) loginRememberMe.checked = true;
    }
    if (loginPassword) loginPassword.value = '';
    if (loginErrorMsg) loginErrorMsg.textContent = '';
    userLoginModal.classList.remove('hidden');
  }

  async function performLogout() {
    try {
      const token = getAuthToken();
      if (token) {
        await fetch('/api/user-auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (e) {
      console.warn('[Auth] Logout error:', e.message);
    }
    setAuthToken(null);
    state.currentUser = null;
    showToast('🚪 Signed out successfully.', 'info');
    if (headerUserDropdown) headerUserDropdown.classList.add('hidden');
    if (userManagementModal) userManagementModal.classList.add('hidden');
    await checkDashboardUserAuth();
  }

  async function checkDashboardUserAuth() {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/user-auth/status', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();

      state.requireLogin = (data.require_login !== false);
      state.requireAdminApproval = (data.require_admin_approval === true);
      state.requireEmailVerification = (data.require_email_verification === true);
      state.allowRegistration = (data.allow_registration !== false);
      state.authNotice = data.auth_notice || '';
      state.authNoticeEnabled = (data.auth_notice_enabled !== false);
      if (typeof updateAccessControlBadges === 'function') updateAccessControlBadges();
      if (statAccessMode) statAccessMode.textContent = state.requireLogin ? 'Protected (Login)' : 'Public Access';

      const pendingCount = data.pending_count || 0;
      if (userPendingTabCount) userPendingTabCount.textContent = pendingCount;
      if (headerPendingBadge) headerPendingBadge.classList.toggle('hidden', pendingCount === 0);
      if (manageUsersPendingBadge) {
        manageUsersPendingBadge.classList.toggle('hidden', pendingCount === 0);
        manageUsersPendingBadge.textContent = `${pendingCount} pending`;
      }

      if (data.logged_in && data.user) {
        state.currentUser = data.user;

        // Update Top Navigation Bar
        if (headerSignInBtn) headerSignInBtn.classList.add('hidden');
        if (headerUserMenuContainer) headerUserMenuContainer.classList.remove('hidden');
        if (headerUserAvatar) {
          const letter = (data.user.name || data.user.username || 'U')[0].toUpperCase();
          headerUserAvatar.firstElementChild.textContent = letter;
        }
        if (userNavLabel) userNavLabel.textContent = data.user.name || data.user.username;
        if (userRoleBadge) {
          userRoleBadge.textContent = data.user.role === 'admin' ? 'Admin' : 'Viewer';
          userRoleBadge.className = data.user.role === 'admin' 
            ? 'px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-purple-200/80 dark:bg-purple-900 text-purple-900 dark:text-purple-100'
            : 'px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300';
        }
        if (dropdownUserFullName) dropdownUserFullName.textContent = data.user.name || 'User';
        if (dropdownUserUsername) dropdownUserUsername.textContent = '@' + data.user.username;

        // Admin-only controls visibility: strictly hidden for viewer accounts
        const isAdmin = data.user.role === 'admin';
        if (dropdownManageUsersBtn) dropdownManageUsersBtn.classList.toggle('hidden', !isAdmin);
        if (dropdownSocketMonitorLink) dropdownSocketMonitorLink.classList.toggle('hidden', !isAdmin);
        if (settingOpenUserMgmtBtn) settingOpenUserMgmtBtn.classList.toggle('hidden', !isAdmin);
        if (settingAdminTabBtn) settingAdminTabBtn.classList.toggle('hidden', !isAdmin);
        if (settingAdminSection) settingAdminSection.classList.toggle('hidden', !isAdmin);
        if (settingRequireLoginToggle) settingRequireLoginToggle.disabled = !isAdmin;
        if (settingRequireApprovalToggle) settingRequireApprovalToggle.disabled = !isAdmin;
        if (settingRequireEmailVerificationToggle) settingRequireEmailVerificationToggle.disabled = !isAdmin;

        // Update Settings Category 5 Account Card & Role Badge
        if (settingAccountStatusLabel) settingAccountStatusLabel.textContent = `Signed in as ${data.user.name || data.user.username}`;
        if (settingAccountUserLabel) settingAccountUserLabel.textContent = `@${data.user.username} (${isAdmin ? 'Administrator' : 'Viewer'})`;
        if (settingAccountRoleBadge) {
          settingAccountRoleBadge.textContent = isAdmin ? 'Administrator' : 'Viewer';
          settingAccountRoleBadge.className = isAdmin 
            ? 'text-[10px] px-2 py-0.2 rounded-full font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' 
            : 'text-[10px] px-2 py-0.2 rounded-full font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300';
        }
        if (settingAccountAvatar) {
          const letter = (data.user.name || data.user.username || 'U').charAt(0).toUpperCase();
          settingAccountAvatar.innerHTML = `<span>${letter}</span>`;
        }
        if (settingAuthActionBtn) {
          settingAuthActionBtn.textContent = 'Sign Out';
          settingAuthActionBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border border-rose-300 dark:border-rose-800 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0';
        }

        // Load user-wise 24/7 background radar targets & popular routes
        loadUserWatchlistFromServer();
        loadPopularRoutesFromServer();
      } else {
        state.currentUser = null;

        // Update Top Navigation Bar
        if (headerSignInBtn) headerSignInBtn.classList.remove('hidden');
        if (headerUserMenuContainer) headerUserMenuContainer.classList.add('hidden');
        if (userNavLabel) userNavLabel.textContent = 'Users';
        if (userRoleBadge) userRoleBadge.classList.add('hidden');
        if (dropdownManageUsersBtn) dropdownManageUsersBtn.classList.add('hidden');
        if (dropdownSocketMonitorLink) dropdownSocketMonitorLink.classList.add('hidden');
        if (settingOpenUserMgmtBtn) settingOpenUserMgmtBtn.classList.add('hidden');
        if (settingAdminTabBtn) settingAdminTabBtn.classList.add('hidden');
        if (settingAdminSection) settingAdminSection.classList.add('hidden');
        if (settingRequireLoginToggle) settingRequireLoginToggle.disabled = true;
        if (settingRequireApprovalToggle) settingRequireApprovalToggle.disabled = true;
        if (settingRequireEmailVerificationToggle) settingRequireEmailVerificationToggle.disabled = true;

        // Update Settings Category 5 Account Card
        if (settingAccountStatusLabel) settingAccountStatusLabel.textContent = 'Not Signed In';
        if (settingAccountUserLabel) settingAccountUserLabel.textContent = 'Public Visitor';
        if (settingAccountRoleBadge) {
          settingAccountRoleBadge.textContent = 'Public Visitor';
          settingAccountRoleBadge.className = 'text-[10px] px-2 py-0.2 rounded-full font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
        }
        if (settingAccountAvatar) {
          settingAccountAvatar.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
        if (settingAuthActionBtn) {
          settingAuthActionBtn.textContent = 'Sign In';
          settingAuthActionBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs shrink-0';
        }

        // If requireLogin is active and user is not logged in, prompt login modal
        if (state.requireLogin && userLoginModal) {
          openLoginModal();
        }
      }

      // Synchronize Shohoz session credentials & profile for this specific user
      await checkRailwaySessionStatus();
    } catch (e) {
      console.warn('[Auth] Check status error:', e.message);
    }
  }

  let currentUserFilter = 'all'; // 'all' | 'pending'

  async function loadUsersList() {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/users', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();

      if (data.success && Array.isArray(data.users)) {
        cachedUsersList = data.users;
        
        const pendingCount = data.pending_count || data.users.filter(u => u.status === 'pending').length;

        // Update stats
        if (statTotalUsers) statTotalUsers.textContent = data.users.length;
        if (statActiveUsers) statActiveUsers.textContent = data.users.filter(u => u.status === 'active').length;
        if (data.require_login !== undefined) {
          state.requireLogin = (data.require_login !== false);
        }
        if (data.require_admin_approval !== undefined) {
          state.requireAdminApproval = (data.require_admin_approval === true);
        }
        if (data.require_email_verification !== undefined) {
          state.requireEmailVerification = (data.require_email_verification === true);
        }
        if (data.allow_registration !== undefined) {
          state.allowRegistration = (data.allow_registration !== false);
        }
        if (data.auth_notice !== undefined) {
          state.authNotice = data.auth_notice || '';
        }
        if (data.auth_notice_enabled !== undefined) {
          state.authNoticeEnabled = (data.auth_notice_enabled !== false);
        }
        if (typeof updateAccessControlBadges === 'function') updateAccessControlBadges();
        if (userListTabCount) userListTabCount.textContent = data.users.length;
        if (userPendingTabCount) userPendingTabCount.textContent = pendingCount;
        if (settingUserCountBadge) settingUserCountBadge.textContent = `${data.users.length} User${data.users.length > 1 ? 's' : ''}`;

        if (headerPendingBadge) headerPendingBadge.classList.toggle('hidden', pendingCount === 0);
        if (manageUsersPendingBadge) {
          manageUsersPendingBadge.classList.toggle('hidden', pendingCount === 0);
          manageUsersPendingBadge.textContent = `${pendingCount} pending`;
        }

        renderUsersList(data.users);
      }
    } catch (e) {
      console.warn('[Users] Error loading users list:', e.message);
    }
  }

  function renderUsersList(users) {
    if (!usersCardsContainer) return;

    let filtered = users;
    if (currentUserFilter === 'pending') {
      filtered = filtered.filter(u => u.status === 'pending');
    }

    const searchTerm = (userSearchInput ? userSearchInput.value : '').toLowerCase().trim();
    if (searchTerm) {
      filtered = filtered.filter(u => 
        (u.name && u.name.toLowerCase().includes(searchTerm)) ||
        (u.username && u.username.toLowerCase().includes(searchTerm))
      );
    }

    if (filtered.length === 0) {
      const emptyMsg = currentUserFilter === 'pending'
        ? 'No pending approval requests. All registered users are approved!'
        : `No users found matching "${searchTerm}".`;
      usersCardsContainer.innerHTML = `
        <div class="py-8 text-center text-slate-400 space-y-1">
          <i class="fa-solid fa-user-check text-2xl text-slate-300 dark:text-slate-600"></i>
          <p class="text-xs font-semibold">${emptyMsg}</p>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach(u => {
      const isAdmin = (u.role === 'admin');
      const isActive = (u.status === 'active');
      const isPending = (u.status === 'pending');
      const isGoogle = (u.authProvider === 'firebase_google');
      const isCurrent = state.currentUser && state.currentUser.id === u.id;
      const initials = (u.name || u.username || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      const deviceLabel = u.lastDevice ? `${u.lastDevice.os} • ${u.lastDevice.browser}` : (u.lastIp ? 'Web Client' : 'No activity');

      html += `
        <div class="py-3 px-2 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${isPending ? 'bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40' : 'border border-transparent'}">
          <!-- Left: User Identity & Telemetry Details -->
          <div class="flex items-start space-x-3 min-w-0">
            <div class="w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs shrink-0 mt-0.5 ${
              isPending
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                : isAdmin 
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-700/60' 
                : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700/60'
            }">
              ${initials}
            </div>

            <div class="min-w-0 space-y-1">
              <div class="flex items-center space-x-2 flex-wrap gap-y-0.5">
                <span class="font-extrabold text-xs text-slate-900 dark:text-white truncate">${u.name}</span>
                ${isCurrent ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">You</span>' : ''}
                <span class="text-[10px] text-slate-400 font-mono">@${u.username}</span>
                ${u.email ? `<span class="text-[10px] text-slate-400 truncate max-w-[140px] hidden md:inline">(${u.email})</span>` : ''}
              </div>

              <!-- Badges Line 1: Role, Status, Auth Provider -->
              <div class="flex items-center space-x-1.5 text-[10px] font-mono flex-wrap gap-y-1">
                <span class="px-1.5 py-0.2 rounded-full font-bold ${
                  isAdmin ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                }">
                  ${isAdmin ? '👑 Admin' : '👁️ Viewer'}
                </span>
                <span class="px-1.5 py-0.2 rounded-full font-bold ${
                  isPending ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700' :
                  isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 
                  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                }">
                  ${isPending ? '⏳ Pending' : isActive ? 'Active' : 'Disabled'}
                </span>
                <span class="px-1.5 py-0.2 rounded-full font-bold ${
                  isGoogle ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                }">
                  ${isGoogle ? '<i class="fa-brands fa-google text-[9px] mr-0.5"></i>Google' : '<i class="fa-solid fa-key text-[9px] mr-0.5"></i>Password'}
                </span>
                ${u.emailVerified ? '<span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300"><i class="fa-solid fa-check text-[8px] mr-0.5"></i>Verified</span>' : ''}
              </div>

              <!-- Badges Line 2: Public/Shared IP, Geo Location, and Device Info -->
              <div class="flex items-center space-x-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono flex-wrap gap-y-1 pt-0.5">
                <span class="inline-flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-700/60">
                  <i class="fa-solid fa-globe text-blue-500 text-[9px]"></i>
                  <span class="font-bold text-slate-700 dark:text-slate-300">${u.lastIp || 'No IP recorded'}</span>
                </span>
                ${u.lastLocation ? `
                  <span class="inline-flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-700/60 font-bold text-slate-700 dark:text-slate-300" title="${u.lastLocation.isp || ''}">
                    <span>${u.lastLocation.flag || '🌐'}</span>
                    <span>${u.lastLocation.city || ''}${u.lastLocation.countryCode ? `, ${u.lastLocation.countryCode}` : ''}</span>
                  </span>
                ` : ''}
                <span class="inline-flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-700/60">
                  <i class="fa-solid fa-${u.lastDevice && u.lastDevice.device === 'Mobile' ? 'mobile-screen' : 'laptop'} text-purple-500 text-[9px]"></i>
                  <span class="truncate max-w-[150px]">${deviceLabel}</span>
                </span>
                ${u.loginCount ? `<span class="text-slate-400">(${u.loginCount} logins)</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Right: Actions & History Inspector -->
          <div class="flex items-center space-x-1.5 shrink-0 self-end sm:self-center">
            <!-- View Activity History & Telemetry Modal -->
            <button type="button" class="user-telemetry-btn p-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition cursor-pointer" data-id="${u.id}" title="View IP, Device, and User Data History">
              <i class="fa-solid fa-chart-line text-[11px]"></i>
            </button>

            ${isPending ? `
              <!-- Quick 1-Click Approve Button -->
              <button type="button" class="user-approve-btn px-2.5 py-1 rounded-lg font-extrabold text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition flex items-center space-x-1 cursor-pointer" data-id="${u.id}" data-username="${u.username}" title="Approve this user account">
                <i class="fa-solid fa-check"></i>
                <span>Approve</span>
              </button>

              <!-- Quick Reject / Delete Button -->
              <button type="button" class="user-delete-btn p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer" data-id="${u.id}" data-username="${u.username}" title="Reject & Remove">
                <i class="fa-solid fa-xmark text-[11px]"></i>
              </button>
            ` : `
              <!-- Toggle Active / Disabled -->
              <button type="button" class="user-toggle-status-btn px-2.5 py-1 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                isActive 
                  ? 'border-slate-200 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300' 
                  : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
              }" data-id="${u.id}" data-username="${u.username}" title="${isActive ? 'Disable account' : 'Enable account'}">
                ${isActive ? 'Disable' : 'Enable'}
              </button>

              <!-- Edit User Details -->
              <button type="button" class="user-edit-btn p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-950/40 transition cursor-pointer" data-id="${u.id}" data-username="${u.username}" data-name="${encodeURIComponent(u.name || '')}" data-email="${encodeURIComponent(u.email || '')}" data-role="${u.role || 'viewer'}" data-status="${u.status || 'active'}" title="Edit User">
                <i class="fa-solid fa-user-pen text-[10px]"></i>
              </button>

              <!-- Reset Password -->
              <button type="button" class="user-reset-pwd-btn p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-950/40 transition cursor-pointer" data-id="${u.id}" data-username="${u.username}" title="Reset Password">
                <i class="fa-solid fa-key text-[10px]"></i>
              </button>

              <!-- Delete User -->
              <button type="button" class="user-delete-btn p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer" data-id="${u.id}" data-username="${u.username}" title="Delete User">
                <i class="fa-solid fa-trash-can text-[10px]"></i>
              </button>
            `}
          </div>
        </div>
      `;
    });

    usersCardsContainer.innerHTML = html;
  }

  function initUserManagement() {
    checkDashboardUserAuth();
    loadUsersList();

    // 1. Header Sign In Button Click
    if (headerSignInBtn) {
      headerSignInBtn.addEventListener('click', () => {
        openLoginModal();
      });
    }

    // 2. Header User Dropdown Toggle
    if (headerUserDropdownBtn && headerUserDropdown) {
      headerUserDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        headerUserDropdown.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        if (headerUserMenuContainer && !headerUserMenuContainer.contains(e.target)) {
          headerUserDropdown.classList.add('hidden');
        }
      });
    }

    // 3. Header Dropdown Actions
    if (dropdownManageUsersBtn) {
      dropdownManageUsersBtn.addEventListener('click', () => {
        if (headerUserDropdown) headerUserDropdown.classList.add('hidden');
        if (state.currentUser?.role !== 'admin') {
          showToast('🚫 Access restricted: Administrator permissions required.', 'error');
          return;
        }
        if (userManagementModal) {
          userManagementModal.classList.remove('hidden');
          loadUsersList();
        }
      });
    }

    if (dropdownChangePasswordBtn) {
      dropdownChangePasswordBtn.addEventListener('click', () => {
        if (headerUserDropdown) headerUserDropdown.classList.add('hidden');
        if (state.currentUser && resetPasswordModal) {
          if (resetPasswordTargetId) resetPasswordTargetId.value = state.currentUser.id;
          if (resetPasswordTargetUsername) resetPasswordTargetUsername.textContent = '@' + state.currentUser.username;
          if (resetPasswordNewInput) resetPasswordNewInput.value = '';
          resetPasswordModal.classList.remove('hidden');
        }
      });
    }

    if (headerLogoutBtn) {
      headerLogoutBtn.addEventListener('click', performLogout);
    }
    if (modalLogoutBtn) {
      modalLogoutBtn.addEventListener('click', performLogout);
    }

    // 4. Settings Account Card Action Button
    if (settingAuthActionBtn) {
      settingAuthActionBtn.addEventListener('click', () => {
        if (state.currentUser) {
          performLogout();
        } else {
          if (settingsDropdown) settingsDropdown.classList.add('hidden');
          openLoginModal();
        }
      });
    }

    // 5. Open User Mgmt Modal from Settings
    if (settingOpenUserMgmtBtn) {
      settingOpenUserMgmtBtn.addEventListener('click', () => {
        if (settingsDropdown) settingsDropdown.classList.add('hidden');
        if (state.currentUser?.role !== 'admin') {
          showToast('🚫 Access restricted: Administrator permissions required.', 'error');
          return;
        }
        if (userManagementModal) {
          userManagementModal.classList.remove('hidden');
          loadUsersList();
        }
      });
    }

    // 6. Close Modal Handlers
    if (userManagementCloseBtn) {
      userManagementCloseBtn.addEventListener('click', () => {
        userManagementModal.classList.add('hidden');
      });
    }
    if (userManagementDoneBtn) {
      userManagementDoneBtn.addEventListener('click', () => {
        userManagementModal.classList.add('hidden');
      });
    }
    if (closeLoginModalBtn) {
      closeLoginModalBtn.addEventListener('click', () => {
        userLoginModal.classList.add('hidden');
      });
    }
    if (resetPasswordCloseBtn) {
      resetPasswordCloseBtn.addEventListener('click', () => {
        resetPasswordModal.classList.add('hidden');
      });
    }

    // 7. Login / Register Modal Tab Switching
    if (loginTabBtn && registerTabBtn && loginSection && registerSection) {
      loginTabBtn.addEventListener('click', () => {
        loginTabBtn.className = 'py-2 rounded-lg font-extrabold text-xs bg-purple-600 text-white shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer';
        registerTabBtn.className = 'py-2 rounded-lg font-bold text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5 cursor-pointer';
        loginSection.classList.remove('hidden');
        registerSection.classList.add('hidden');
        if (loginErrorMsg) loginErrorMsg.textContent = '';
      });

      registerTabBtn.addEventListener('click', () => {
        registerTabBtn.className = 'py-2 rounded-lg font-extrabold text-xs bg-emerald-600 text-white shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer';
        loginTabBtn.className = 'py-2 rounded-lg font-bold text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5 cursor-pointer';
        registerSection.classList.remove('hidden');
        loginSection.classList.add('hidden');
        if (registerStatusMsg) registerStatusMsg.textContent = '';
      });
    }

    // 8. User Management Modal Tab Switching (All Users / Pending / Add)
    if (userTabListBtn) {
      userTabListBtn.addEventListener('click', () => {
        currentUserFilter = 'all';
        userTabListBtn.className = 'px-3 py-1.5 rounded-xl font-bold bg-purple-600 text-white shadow-2xs transition cursor-pointer';
        if (userTabPendingBtn) userTabPendingBtn.className = 'px-3 py-1.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer';
        if (userTabAddBtn) userTabAddBtn.className = 'px-3 py-1.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer';
        userSectionList.classList.remove('hidden');
        userSectionAdd.classList.add('hidden');
        renderUsersList(cachedUsersList);
      });
    }

    if (userTabPendingBtn) {
      userTabPendingBtn.addEventListener('click', () => {
        currentUserFilter = 'pending';
        userTabPendingBtn.className = 'px-3 py-1.5 rounded-xl font-bold bg-amber-600 text-white shadow-2xs transition cursor-pointer';
        if (userTabListBtn) userTabListBtn.className = 'px-3 py-1.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer';
        if (userTabAddBtn) userTabAddBtn.className = 'px-3 py-1.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer';
        userSectionList.classList.remove('hidden');
        userSectionAdd.classList.add('hidden');
        renderUsersList(cachedUsersList);
      });
    }

    if (userTabAddBtn) {
      userTabAddBtn.addEventListener('click', () => {
        userTabAddBtn.className = 'px-3 py-1.5 rounded-xl font-bold bg-purple-600 text-white shadow-2xs transition cursor-pointer';
        if (userTabListBtn) userTabListBtn.className = 'px-3 py-1.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer';
        if (userTabPendingBtn) userTabPendingBtn.className = 'px-3 py-1.5 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer';
        userSectionAdd.classList.remove('hidden');
        userSectionList.classList.add('hidden');
        if (addUserFormStatus) addUserFormStatus.textContent = '';
      });
    }

    // 9. Search Filter
    if (userSearchInput) {
      userSearchInput.addEventListener('input', () => {
        renderUsersList(cachedUsersList);
      });
    }

    // Helper to update visual badges for access control & live broadcast notices
    function updateAccessControlBadges() {
      if (badgeRequireLoginStatus) {
        badgeRequireLoginStatus.textContent = state.requireLogin ? 'Protected' : 'Public';
        badgeRequireLoginStatus.className = state.requireLogin
          ? 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300'
          : 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
      }
      if (badgeAllowRegistrationStatus) {
        const isOpen = state.allowRegistration !== false;
        badgeAllowRegistrationStatus.textContent = isOpen ? 'Open' : 'Closed';
        badgeAllowRegistrationStatus.className = isOpen
          ? 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
          : 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300';
      }
      if (badgeRequireApprovalStatus) {
        const isReq = (state.requireAdminApproval === true);
        badgeRequireApprovalStatus.textContent = isReq ? 'Required' : 'Instant (Auto)';
        badgeRequireApprovalStatus.className = isReq
          ? 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
          : 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300';
      }
      if (badgeRequireEmailVerificationStatus) {
        const isReq = (state.requireEmailVerification === true);
        badgeRequireEmailVerificationStatus.textContent = isReq ? 'Required' : 'Disabled (Instant)';
        badgeRequireEmailVerificationStatus.className = isReq
          ? 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300'
          : 'px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
      }
      if (modalRequireLoginToggle) modalRequireLoginToggle.checked = (state.requireLogin !== false);
      if (settingRequireLoginToggle) settingRequireLoginToggle.checked = (state.requireLogin !== false);
      if (modalAllowRegistrationToggle) modalAllowRegistrationToggle.checked = (state.allowRegistration !== false);
      if (modalRequireApprovalToggle) modalRequireApprovalToggle.checked = (state.requireAdminApproval === true);
      if (settingRequireApprovalToggle) settingRequireApprovalToggle.checked = (state.requireAdminApproval === true);
      if (modalRequireEmailVerificationToggle) modalRequireEmailVerificationToggle.checked = (state.requireEmailVerification === true);
      if (settingRequireEmailVerificationToggle) settingRequireEmailVerificationToggle.checked = (state.requireEmailVerification === true);

      if (adminAuthNoticeToggle) adminAuthNoticeToggle.checked = (state.authNoticeEnabled !== false);
      if (adminAuthNoticeInput && document.activeElement !== adminAuthNoticeInput) {
        adminAuthNoticeInput.value = state.authNotice || '';
      }

      // Update Live Notice in Login & Registration Modal
      if (authNoticeBanner && authNoticeText) {
        const hasNotice = !!(state.authNotice && state.authNotice.trim() && state.authNoticeEnabled !== false);
        if (hasNotice) {
          authNoticeText.textContent = state.authNotice.trim();
          authNoticeBanner.classList.remove('hidden');
        } else {
          authNoticeBanner.classList.add('hidden');
        }
      }

      // Update Dynamic Registration Policy Banner & Button Labels
      const registerPolicyBanner = document.getElementById('registerPolicyBanner');
      const registerPolicyText = document.getElementById('registerPolicyText');
      const registerEmailHint = document.getElementById('registerEmailHint');
      const submitRegisterBtnText = document.getElementById('submitRegisterBtnText');
      const submitRegisterBtnIcon = document.getElementById('submitRegisterBtnIcon');

      const reqEmail = (state.requireEmailVerification === true);
      const reqApproval = (state.requireAdminApproval === true);

      if (registerPolicyBanner && registerPolicyText) {
        if (reqEmail && reqApproval) {
          registerPolicyText.innerHTML = '<strong>Verification Policy:</strong> A verification link will be sent to your email. Administrator approval is required before dashboard access.';
          registerPolicyBanner.classList.remove('hidden');
        } else if (reqEmail) {
          registerPolicyText.innerHTML = '<strong>Email Verification Required:</strong> A verification link will be sent to your email to verify your account.';
          registerPolicyBanner.classList.remove('hidden');
        } else if (reqApproval) {
          registerPolicyText.innerHTML = '<strong>Administrator Approval Required:</strong> Your account will be reviewed by the administrator before dashboard access is granted.';
          registerPolicyBanner.classList.remove('hidden');
        } else {
          // Both off — completely hide verification/approval banner!
          registerPolicyBanner.classList.add('hidden');
        }
      }

      if (registerEmailHint) {
        registerEmailHint.classList.toggle('hidden', !reqEmail);
      }

      if (submitRegisterBtnText) {
        if (reqEmail && reqApproval) {
          submitRegisterBtnText.textContent = 'Create Account & Send Verification';
        } else if (reqEmail) {
          submitRegisterBtnText.textContent = 'Create Account & Verify Email';
        } else if (reqApproval) {
          submitRegisterBtnText.textContent = 'Submit Registration for Approval';
        } else {
          submitRegisterBtnText.textContent = 'Create Account';
        }
      }

      if (submitRegisterBtnIcon) {
        submitRegisterBtnIcon.className = reqEmail ? 'fa-solid fa-paper-plane' : 'fa-solid fa-user-plus';
      }

      // Update Registration Open/Closed State in Auth Modal
      if (registrationClosedBanner) {
        const isRegClosed = (state.allowRegistration === false);
        registrationClosedBanner.classList.toggle('hidden', !isRegClosed);
        if (registerTabBtnText) {
          registerTabBtnText.textContent = isRegClosed ? 'Signup Closed' : 'Create Account';
        }
        if (registerTabBtn) {
          registerTabBtn.classList.toggle('opacity-50', isRegClosed);
        }
        if (submitRegisterBtn) {
          submitRegisterBtn.disabled = isRegClosed;
        }
      }
    }

    // 10. Require Login Toggle Handler
    async function handleRequireLoginChange(isChecked) {
      try {
        const token = getAuthToken();
        const res = await fetch('/api/users/update-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ requireLogin: isChecked })
        });
        const data = await res.json();
        if (data.success) {
          state.requireLogin = !!data.require_login;
          updateAccessControlBadges();
          if (statAccessMode) statAccessMode.textContent = state.requireLogin ? 'Protected (Login)' : 'Public Access';
          showToast(data.message, 'success');
        }
      } catch (e) {
        showToast('Failed to update access control setting.', 'error');
      }
    }

    if (modalRequireLoginToggle) {
      modalRequireLoginToggle.addEventListener('change', () => {
        handleRequireLoginChange(modalRequireLoginToggle.checked);
      });
    }
    if (settingRequireLoginToggle) {
      settingRequireLoginToggle.addEventListener('change', () => {
        handleRequireLoginChange(settingRequireLoginToggle.checked);
      });
    }

    // 10.1. Require Admin Approval Toggle Handler
    async function handleRequireAdminApprovalChange(isChecked) {
      try {
        const token = getAuthToken();
        const res = await fetch('/api/users/update-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ requireAdminApproval: isChecked })
        });
        const data = await res.json();
        if (data.success) {
          state.requireAdminApproval = (data.require_admin_approval === true);
          updateAccessControlBadges();
          showToast(
            state.requireAdminApproval
              ? '🔒 Admin Approval is ON: New signups require admin approval.'
              : '⚡ Admin Approval is OFF: New users are activated instantly without admin approval!',
            'success'
          );
        }
      } catch (e) {
        showToast('Failed to update admin approval setting.', 'error');
      }
    }

    if (modalRequireApprovalToggle) {
      modalRequireApprovalToggle.addEventListener('change', () => {
        handleRequireAdminApprovalChange(modalRequireApprovalToggle.checked);
      });
    }
    if (settingRequireApprovalToggle) {
      settingRequireApprovalToggle.addEventListener('change', () => {
        handleRequireAdminApprovalChange(settingRequireApprovalToggle.checked);
      });
    }

    // 10.2. Require Email Verification Toggle Handler
    async function handleRequireEmailVerificationChange(isChecked) {
      try {
        const token = getAuthToken();
        const res = await fetch('/api/users/update-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ requireEmailVerification: isChecked })
        });
        const data = await res.json();
        if (data.success) {
          state.requireEmailVerification = (data.require_email_verification === true);
          updateAccessControlBadges();
          showToast(
            state.requireEmailVerification
              ? '✉️ Email Verification is ON: New users must verify their email link.'
              : '⚡ Email Verification is OFF: New users do NOT need email verification!',
            'success'
          );
        }
      } catch (e) {
        showToast('Failed to update email verification setting.', 'error');
      }
    }

    if (modalRequireEmailVerificationToggle) {
      modalRequireEmailVerificationToggle.addEventListener('change', () => {
        handleRequireEmailVerificationChange(modalRequireEmailVerificationToggle.checked);
      });
    }
    if (settingRequireEmailVerificationToggle) {
      settingRequireEmailVerificationToggle.addEventListener('change', () => {
        handleRequireEmailVerificationChange(settingRequireEmailVerificationToggle.checked);
      });
    }

    // 10.3. Allow Registration Toggle Handler (Turn On/Off Account Creation)
    async function handleAllowRegistrationChange(isChecked) {
      try {
        const token = getAuthToken();
        const res = await fetch('/api/users/update-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ allowRegistration: isChecked })
        });
        const data = await res.json();
        if (data.success) {
          state.allowRegistration = (data.allow_registration !== false);
          updateAccessControlBadges();
          showToast(
            state.allowRegistration
              ? '📝 Signup is OPEN: New users can create accounts.'
              : '🔒 Signup is CLOSED: New account registration is turned OFF.',
            'success'
          );
        }
      } catch (e) {
        showToast('Failed to update registration setting.', 'error');
      }
    }

    if (modalAllowRegistrationToggle) {
      modalAllowRegistrationToggle.addEventListener('change', () => {
        handleAllowRegistrationChange(modalAllowRegistrationToggle.checked);
      });
    }

    // 10.4. Live Auth Notice Save & Toggle Handler
    async function handleSaveAuthNotice(noticeText, isEnabled) {
      try {
        const token = getAuthToken();
        const res = await fetch('/api/users/update-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            authNotice: noticeText,
            authNoticeEnabled: isEnabled
          })
        });
        const data = await res.json();
        if (data.success) {
          state.authNotice = data.auth_notice || '';
          state.authNoticeEnabled = (data.auth_notice_enabled !== false);
          updateAccessControlBadges();
          showToast('📢 Live broadcast notice updated & synced to all users!', 'success');
        }
      } catch (e) {
        showToast('Failed to save broadcast notice.', 'error');
      }
    }

    if (adminSaveAuthNoticeBtn) {
      adminSaveAuthNoticeBtn.addEventListener('click', () => {
        const text = (adminAuthNoticeInput ? adminAuthNoticeInput.value : '').trim();
        const isEnabled = adminAuthNoticeToggle ? adminAuthNoticeToggle.checked : true;
        handleSaveAuthNotice(text, isEnabled);
      });
    }

    if (adminAuthNoticeToggle) {
      adminAuthNoticeToggle.addEventListener('change', () => {
        const text = (adminAuthNoticeInput ? adminAuthNoticeInput.value : '').trim();
        handleSaveAuthNotice(text, adminAuthNoticeToggle.checked);
      });
    }

    // Setup Live Firestore Snapshot Listener for Real-Time Notice & Policy Sync across all devices
    function setupFirestoreRealtimeSettingsListener() {
      try {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
          const db = firebase.firestore();
          db.collection('system_config').doc('settings').onSnapshot(doc => {
            if (doc && doc.exists) {
              const data = doc.data() || {};
              if (data.requireLogin !== undefined) state.requireLogin = (data.requireLogin !== false);
              if (data.requireAdminApproval !== undefined) state.requireAdminApproval = (data.requireAdminApproval === true);
              if (data.requireEmailVerification !== undefined) state.requireEmailVerification = (data.requireEmailVerification === true);
              if (data.allowRegistration !== undefined) state.allowRegistration = (data.allowRegistration !== false);
              if (data.authNotice !== undefined) state.authNotice = data.authNotice || '';
              if (data.authNoticeEnabled !== undefined) state.authNoticeEnabled = (data.authNoticeEnabled !== false);
              updateAccessControlBadges();
              console.log('[Firestore Sync] ⚡ Live settings & notice synchronized in real-time');
            }
          }, err => {
            console.warn('[Firestore Sync] Snapshot listener warning:', err.message);
          });
        }
      } catch (e) {
        console.warn('[Firestore Sync] Real-time listener init warning:', e.message);
      }
    }

    // Attempt listener attachment
    setTimeout(setupFirestoreRealtimeSettingsListener, 2000);

    // 11. Add User Form Submission (Admin Panel)
    if (addUserForm) {
      addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = addUserName.value.trim();
        const username = addUserUsername.value.trim();
        const password = addUserPassword.value.trim();
        const role = addUserRole.value;
        const status = addUserStatus.value;

        if (!username || !password) return;

        submitAddUserBtn.disabled = true;
        submitAddUserBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Creating User...';
        if (addUserFormStatus) addUserFormStatus.textContent = '';

        try {
          const token = getAuthToken();
          const res = await fetch('/api/users/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
            body: JSON.stringify({ name, username, password, role, status })
          });
          const data = await res.json();

          if (data.success) {
            showToast(`✅ User @${username} added successfully!`, 'success');
            addUserForm.reset();
            if (userTabListBtn) userTabListBtn.click();
            loadUsersList();
          } else {
            if (addUserFormStatus) {
              addUserFormStatus.textContent = `❌ ${data.error || 'Failed to create user.'}`;
              addUserFormStatus.className = 'text-xs font-semibold text-center text-rose-600';
            }
          }
        } catch (err) {
          if (addUserFormStatus) {
            addUserFormStatus.textContent = '❌ Network error.';
            addUserFormStatus.className = 'text-xs font-semibold text-center text-rose-600';
          }
        } finally {
          submitAddUserBtn.disabled = false;
          submitAddUserBtn.innerHTML = '<i class="fa-solid fa-user-plus mr-1"></i> Create User Account';
        }
      });
    }

    // 12. User Self-Registration Form Submission (Public Form with Email Verification)
    if (userRegisterForm) {
      userRegisterForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = registerName.value.trim();
        const email = registerEmail ? registerEmail.value.trim().toLowerCase() : '';
        const username = registerUsername.value.trim().toLowerCase();
        const password = registerPassword.value.trim();
        const confirmPassword = registerConfirmPassword.value.trim();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (registerStatusMsg) {
            registerStatusMsg.textContent = '❌ Please enter a valid email address.';
            registerStatusMsg.className = 'text-xs font-semibold text-center text-rose-600';
          }
          return;
        }

        if (password !== confirmPassword) {
          if (registerStatusMsg) {
            registerStatusMsg.textContent = '❌ Passwords do not match.';
            registerStatusMsg.className = 'text-xs font-semibold text-center text-rose-600';
          }
          return;
        }

        const reqEmail = (state.requireEmailVerification === true);
        const reqApproval = (state.requireAdminApproval === true);

        submitRegisterBtn.disabled = true;
        submitRegisterBtn.innerHTML = reqEmail
          ? '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Creating Account & Sending Verification...'
          : '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Creating Account...';
        if (registerStatusMsg) registerStatusMsg.textContent = '';

        let firebaseUid = null;
        try {
          // Only attempt Firebase Auth creation & email verification if Email Verification is ENABLED
          if (reqEmail && window.firebase && firebase.auth) {
            ensureFirebaseInitialized();
            try {
              const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
              if (cred.user) {
                firebaseUid = cred.user.uid;
                await cred.user.sendEmailVerification();
                console.log('[Firebase Auth] ✉️ Verification email dispatched to:', email);
              }
            } catch (fbErr) {
              console.warn('[Firebase Auth] Client user create note:', fbErr.message);
            }
          }

          const res = await fetch('/api/user-auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, username, password, firebaseUid, emailVerified: !reqEmail })
          });
          const data = await res.json();

          if (data.success) {
            if (registerStatusMsg) {
              if (reqEmail && reqApproval) {
                registerStatusMsg.innerHTML = `✅ <strong>Verification Email Sent!</strong><br><span class="text-[11px] font-normal">A verification link has been sent to <strong>${email}</strong>. Please check your inbox to verify your account, then await administrator approval.</span>`;
              } else if (reqEmail) {
                registerStatusMsg.innerHTML = `✅ <strong>Verification Email Sent!</strong><br><span class="text-[11px] font-normal">A verification link has been sent to <strong>${email}</strong>. Please check your inbox (and spam folder) to verify your account.</span>`;
              } else if (reqApproval) {
                registerStatusMsg.innerHTML = `✅ <strong>Registration Submitted!</strong><br><span class="text-[11px] font-normal">Your account has been submitted and is pending administrator approval before sign-in.</span>`;
              } else {
                registerStatusMsg.innerHTML = `✅ <strong>Registration Successful!</strong><br><span class="text-[11px] font-normal">Your account is ready! You can now sign in immediately.</span>`;
              }
              registerStatusMsg.className = 'text-xs font-bold text-center text-emerald-700 dark:text-emerald-300 p-3 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl border border-emerald-300 dark:border-emerald-700 space-y-1';
            }
            showToast(data.message || (reqEmail ? `✉️ Verification link sent to ${email}` : 'Registration successful!'), 'success');
            userRegisterForm.reset();
            setTimeout(() => {
              if (loginTabBtn) loginTabBtn.click();
              if (loginUsername) loginUsername.value = username;
            }, reqEmail ? 5000 : 2500);
          } else {
            if (registerStatusMsg) {
              registerStatusMsg.textContent = `❌ ${data.error || 'Registration failed.'}`;
              registerStatusMsg.className = 'text-xs font-semibold text-center text-rose-600';
            }
          }
        } catch (err) {
          if (registerStatusMsg) {
            registerStatusMsg.textContent = '❌ Network error during registration.';
            registerStatusMsg.className = 'text-xs font-semibold text-center text-rose-600';
          }
        } finally {
          submitRegisterBtn.disabled = false;
          const btnText = reqEmail ? (reqApproval ? 'Create Account & Send Verification' : 'Create Account & Verify Email') : (reqApproval ? 'Submit Registration for Approval' : 'Create Account');
          const btnIcon = reqEmail ? 'fa-paper-plane' : 'fa-user-plus';
          submitRegisterBtn.innerHTML = `<i class="fa-solid ${btnIcon} mr-1" id="submitRegisterBtnIcon"></i> <span id="submitRegisterBtnText">${btnText}</span>`;
        }
      });
    }

    // 13. Login Form Submission (with Email Verification & Remember Me)
    if (userLoginForm) {
      userLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = loginUsername.value.trim();
        const password = loginPassword.value.trim();
        const rememberMe = loginRememberMe ? loginRememberMe.checked : true;

        if (!username || !password) return;

        submitLoginBtn.disabled = true;
        submitLoginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Signing In...';
        if (loginErrorMsg) loginErrorMsg.textContent = '';
        if (resendVerificationContainer) resendVerificationContainer.classList.add('hidden');

        try {
          const res = await fetch('/api/user-auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, rememberMe })
          });
          const data = await res.json();

          if (data.success && data.token) {
            setAuthToken(data.token, rememberMe);
            if (rememberMe) {
              localStorage.setItem('rail_remembered_username', username);
            } else {
              localStorage.removeItem('rail_remembered_username');
            }
            showToast(`👋 Welcome back, ${data.user.name || data.user.username}!`, 'success');
            userLoginModal.classList.add('hidden');
            await checkDashboardUserAuth();
          } else if (data.emailUnverified) {
            if (loginErrorMsg) {
              loginErrorMsg.innerHTML = `<span class="text-amber-600 dark:text-amber-400 font-bold"><i class="fa-solid fa-envelope-circle-check mr-1"></i> Email Verification Required</span><br><span class="text-[11px] text-slate-600 dark:text-slate-300 font-normal">Please click the verification link sent to <strong>${data.email || 'your email'}</strong> before signing in.</span>`;
            }
            if (resendVerificationContainer) {
              resendVerificationContainer.classList.remove('hidden');
            }
          } else {
            if (loginErrorMsg) {
              loginErrorMsg.textContent = data.error || 'Invalid credentials.';
            }
          }
        } catch (err) {
          if (loginErrorMsg) {
            loginErrorMsg.textContent = 'Network error. Please try again.';
          }
        } finally {
          submitLoginBtn.disabled = false;
          submitLoginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket mr-1"></i> Sign In to Dashboard';
        }
      });
    }

    // 13.0. Resend Email Verification Handler
    if (resendVerificationBtn) {
      resendVerificationBtn.addEventListener('click', async () => {
        const username = loginUsername ? loginUsername.value.trim() : '';
        if (!username) {
          showToast('Please enter your username or email first.', 'info');
          return;
        }

        resendVerificationBtn.disabled = true;
        resendVerificationBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[10px]"></i> Sending...';

        try {
          // Also trigger client-side resend if possible
          if (window.firebase && firebase.auth && firebase.auth().currentUser) {
            try {
              await firebase.auth().currentUser.sendEmailVerification();
            } catch (e) {}
          }

          const res = await fetch('/api/user-auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: username, username })
          });
          const data = await res.json();
          showToast(data.message || 'Verification email resent!', 'success');
        } catch (err) {
          showToast('Network error resending verification email.', 'error');
        } finally {
          resendVerificationBtn.disabled = false;
          resendVerificationBtn.innerHTML = '<i class="fa-solid fa-paper-plane text-[10px]"></i> Resend Verification Email';
        }
      });
    }

    // ----------------------------------------------------
    // 13.1. Firebase Web App Initialization & Google Auth
    // ----------------------------------------------------
    const firebaseConfig = {
      apiKey: "AIzaSyD67AVgu4gq5Ya4txcKJee7XL61na7nd6E",
      authDomain: "railseat-finder-bd.firebaseapp.com",
      projectId: "railseat-finder-bd",
      storageBucket: "railseat-finder-bd.firebasestorage.app",
      messagingSenderId: "266186751082",
      appId: "1:266186751082:web:ee5f2695ac16bda97e9e13",
      measurementId: "G-BVRRX1HN95"
    };

    function ensureFirebaseInitialized() {
      if (window.firebase && !firebase.apps.length) {
        try {
          firebase.initializeApp(firebaseConfig);
          console.log('[Firebase] 🔥 Web App initialized for railseat-finder-bd');
        } catch (err) {
          console.warn('[Firebase] Init error:', err.message);
        }
      }
    }

    // Initialize immediately
    ensureFirebaseInitialized();

    async function handleFirebaseGoogleAuth() {
      try {
        if (!window.firebase || !firebase.auth) {
          showToast('Firebase Auth SDK is still loading. Please refresh and try again.', 'error');
          return;
        }

        ensureFirebaseInitialized();

        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('profile');
        provider.addScope('email');

        showToast('🔑 Opening Google Sign-In...', 'info');
        const result = await firebase.auth().signInWithPopup(provider);
        const idToken = await result.user.getIdToken();
        const rememberMe = loginRememberMe ? loginRememberMe.checked : true;

        showToast('🔐 Verifying Google account with server...', 'info');

        const res = await fetch('/api/user-auth/firebase-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, rememberMe })
        });

        const data = await res.json();
        if (data.success && data.token) {
          setAuthToken(data.token, rememberMe);
          showToast(`👋 Welcome, ${data.user.name || data.user.username}! Signed in with Google.`, 'success');
          userLoginModal.classList.add('hidden');
          await checkDashboardUserAuth();
        } else if (data.registrationClosed) {
          try { await firebase.auth().signOut(); } catch (e) {}
          showToast(data.error || '🔒 New registration is currently closed by administrator.', 'error');
          if (loginErrorMsg) loginErrorMsg.textContent = data.error;
          if (registerStatusMsg) registerStatusMsg.textContent = data.error;
        } else if (data.pending) {
          showToast(data.error || 'Your Google Account is pending administrator approval.', 'info');
          if (loginErrorMsg) loginErrorMsg.textContent = data.error;
          if (registerStatusMsg) registerStatusMsg.textContent = data.error;
        } else {
          try { await firebase.auth().signOut(); } catch (e) {}
          showToast(data.error || 'Google Sign-In failed.', 'error');
          if (loginErrorMsg) loginErrorMsg.textContent = data.error;
          if (registerStatusMsg) registerStatusMsg.textContent = data.error;
        }
      } catch (err) {
        console.warn('[Firebase Auth] Error:', err);
        if (err.code === 'auth/popup-closed-by-user') {
          showToast('Sign-In popup was closed.', 'info');
        } else if (err.code === 'auth/unauthorized-domain') {
          showToast('Authorized domain required. Please ensure localhost is in your Firebase Auth domain list.', 'error');
        } else {
          showToast(err.message || 'Google Sign-In error.', 'error');
        }
      }
    }

    if (firebaseGoogleSignInBtn) {
      firebaseGoogleSignInBtn.addEventListener('click', handleFirebaseGoogleAuth);
    }
    if (firebaseGoogleRegisterBtn) {
      firebaseGoogleRegisterBtn.addEventListener('click', handleFirebaseGoogleAuth);
    }

    // Password visibility toggle button
    if (toggleLoginPasswordBtn && loginPassword) {
      toggleLoginPasswordBtn.addEventListener('click', () => {
        const isPwd = loginPassword.type === 'password';
        loginPassword.type = isPwd ? 'text' : 'password';
        toggleLoginPasswordBtn.innerHTML = isPwd ? '<i class="fa-regular fa-eye-slash text-xs text-purple-600"></i>' : '<i class="fa-regular fa-eye text-xs"></i>';
      });
    }

    // User Telemetry Modal Viewer (Admin)
    function openTelemetryModal(u) {
      if (!userTelemetryModal) return;
      if (telemetryUserName) telemetryUserName.textContent = u.name || u.username;
      if (telemetryUserHandle) telemetryUserHandle.textContent = `@${u.username}${u.email ? ` • ${u.email}` : ''}`;
      if (telemetryLastIp) telemetryLastIp.textContent = u.lastIp || 'No IP recorded';
      
      const dev = u.lastDevice || {};
      const devType = dev.device || 'Desktop';
      const os = dev.os || 'Unknown OS';
      const browser = dev.browser || (u.lastUserAgent ? u.lastUserAgent.substring(0, 40) : 'Unknown');

      if (telemetryDeviceText) telemetryDeviceText.textContent = `${os} (${devType})`;
      if (telemetryDeviceIcon) {
        telemetryDeviceIcon.className = devType === 'Mobile' 
          ? 'fa-solid fa-mobile-screen text-purple-500' 
          : (devType === 'Tablet' ? 'fa-solid fa-tablet-screen-button text-purple-500' : 'fa-solid fa-laptop text-purple-500');
      }
      if (telemetryBrowser) telemetryBrowser.textContent = browser;
      if (telemetryLocation) {
        if (u.lastLocation) {
          telemetryLocation.innerHTML = `<span class="font-bold">${u.lastLocation.flag || '🌐'} ${u.lastLocation.city || 'Unknown'}, ${u.lastLocation.country || ''}</span>`;
        } else {
          telemetryLocation.textContent = '🌐 Location not resolved';
        }
      }
      if (telemetryIsp) {
        telemetryIsp.textContent = u.lastLocation?.isp || 'Standard Network';
      }
      if (telemetryAuthProvider) telemetryAuthProvider.textContent = u.authProvider === 'firebase_google' ? 'Google Sign-In (Firebase)' : 'Username & Password';
      if (telemetryEmailVerified) telemetryEmailVerified.innerHTML = u.emailVerified ? '<span class="text-teal-600 dark:text-teal-400 font-bold">✅ Verified</span>' : '<span class="text-rose-500 font-bold">❌ Not Verified</span>';
      if (telemetryLoginCount) telemetryLoginCount.textContent = `${u.loginCount || 0} time${(u.loginCount || 0) === 1 ? '' : 's'}`;
      if (telemetryLastLogin) telemetryLastLogin.textContent = u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never logged in';
      if (telemetryCreatedAt) telemetryCreatedAt.textContent = u.createdAt ? new Date(u.createdAt).toLocaleString() : 'Unknown';

      // IP History list
      if (telemetryIpList) {
        const ips = (u.ips && u.ips.length) ? u.ips : (u.lastIp ? [u.lastIp] : []);
        if (ips.length) {
          telemetryIpList.innerHTML = ips.map(ip => `
            <span class="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200/80 dark:border-slate-600 font-mono text-[10px] flex items-center space-x-1">
              <i class="fa-solid fa-globe text-blue-500 text-[8px]"></i>
              <span>${ip}</span>
            </span>
          `).join('');
        } else {
          telemetryIpList.innerHTML = '<span class="text-slate-400 text-[10px]">No IP addresses recorded</span>';
        }
      }

      // Activity Log list
      if (telemetryActivityLog) {
        const history = u.activityHistory || [];
        if (history.length) {
          telemetryActivityLog.innerHTML = history.map(item => `
            <div class="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-[10px]">
              <div class="flex items-center space-x-2">
                <span class="px-1.5 py-0.2 rounded font-bold uppercase text-[8px] ${item.action === 'register' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'}">${item.action || 'login'}</span>
                <span class="font-mono text-slate-700 dark:text-slate-300">${item.ip || 'unknown'}</span>
                <span class="text-slate-400 truncate max-w-[120px]">${item.os || ''} • ${item.browser || ''}</span>
              </div>
              <span class="text-slate-400 text-[9px] shrink-0">${item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : ''}</span>
            </div>
          `).join('');
        } else {
          telemetryActivityLog.innerHTML = '<p class="text-slate-400 text-center py-2 text-[10px]">No recent activity entries recorded yet.</p>';
        }
      }

      userTelemetryModal.classList.remove('hidden');
    }

    if (closeTelemetryModalBtn && userTelemetryModal) {
      closeTelemetryModalBtn.addEventListener('click', () => {
        userTelemetryModal.classList.add('hidden');
      });
    }

    // 14. Reset Password Form Submission
    if (resetPasswordForm) {
      resetPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = resetPasswordTargetId.value;
        const newPassword = resetPasswordNewInput.value.trim();

        if (!id || !newPassword) return;

        try {
          const token = getAuthToken();
          const res = await fetch('/api/users/update-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
            body: JSON.stringify({ id, newPassword })
          });
          const data = await res.json();
          if (data.success) {
            showToast('✅ Password updated successfully!', 'success');
            resetPasswordModal.classList.add('hidden');
            resetPasswordNewInput.value = '';
          } else {
            showToast(data.error || 'Failed to update password.', 'error');
          }
        } catch (err) {
          showToast('Network error updating password.', 'error');
        }
      });
    }

    // 15. Delegate Actions for User Cards (Telemetry, Approve, Toggle Status, Edit, Reset Pwd, Delete)
    if (usersCardsContainer) {
      usersCardsContainer.addEventListener('click', async (e) => {
        // View Telemetry & Activity Modal
        const telemetryBtn = e.target.closest('.user-telemetry-btn');
        if (telemetryBtn) {
          const id = telemetryBtn.dataset.id;
          const user = (cachedUsersList || []).find(u => u.id === id);
          if (user) {
            openTelemetryModal(user);
          }
          return;
        }
        // Approve Pending User
        const approveBtn = e.target.closest('.user-approve-btn');
        if (approveBtn) {
          const id = approveBtn.dataset.id;
          const username = approveBtn.dataset.username;
          approveBtn.disabled = true;
          approveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Approving...';
          try {
            const token = getAuthToken();
            const res = await fetch('/api/users/approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
              body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (data.success) {
              showToast(`🎉 User @${username} approved & activated!`, 'success');
              loadUsersList();
              checkDashboardUserAuth();
            } else {
              showToast(data.error || 'Approval failed.', 'error');
              approveBtn.disabled = false;
              approveBtn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Approve';
            }
          } catch (err) {
            showToast('Network error approving user.', 'error');
            approveBtn.disabled = false;
            approveBtn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Approve';
          }
          return;
        }

        // Toggle Status
        const toggleBtn = e.target.closest('.user-toggle-status-btn');
        if (toggleBtn) {
          const id = toggleBtn.dataset.id;
          const username = toggleBtn.dataset.username;
          try {
            const token = getAuthToken();
            const res = await fetch('/api/users/toggle-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
              body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (data.success) {
              showToast(`User @${username} is now ${data.status}.`, 'info');
              loadUsersList();
            } else {
              showToast(data.error || 'Action failed.', 'error');
            }
          } catch (err) {
            showToast('Network error.', 'error');
          }
          return;
        }

        // Edit User Details
        const editBtn = e.target.closest('.user-edit-btn');
        if (editBtn) {
          const id = editBtn.dataset.id;
          const username = editBtn.dataset.username;
          const name = decodeURIComponent(editBtn.dataset.name || '');
          const email = decodeURIComponent(editBtn.dataset.email || '');
          const role = editBtn.dataset.role || 'viewer';
          const status = editBtn.dataset.status || 'active';

          if (editUserTargetId) editUserTargetId.value = id;
          if (editUserTargetUsername) editUserTargetUsername.textContent = '@' + username;
          if (editUserNameInput) editUserNameInput.value = name;
          if (editUserEmailInput) editUserEmailInput.value = email;
          if (editUserRoleSelect) editUserRoleSelect.value = role;
          if (editUserStatusSelect) editUserStatusSelect.value = status;
          if (editUserModal) editUserModal.classList.remove('hidden');
          return;
        }

        // Reset Password
        const resetBtn = e.target.closest('.user-reset-pwd-btn');
        if (resetBtn) {
          const id = resetBtn.dataset.id;
          const username = resetBtn.dataset.username;
          if (resetPasswordTargetId) resetPasswordTargetId.value = id;
          if (resetPasswordTargetUsername) resetPasswordTargetUsername.textContent = '@' + username;
          if (resetPasswordNewInput) resetPasswordNewInput.value = '';
          if (resetPasswordModal) resetPasswordModal.classList.remove('hidden');
          return;
        }

        // Delete / Reject User (Auto-syncs with Firebase)
        const deleteBtn = e.target.closest('.user-delete-btn');
        if (deleteBtn) {
          const id = deleteBtn.dataset.id;
          const username = deleteBtn.dataset.username;
          if (!confirm(`Are you sure you want to remove user @${username}? This will also delete the user from Firebase.`)) return;

          try {
            const token = getAuthToken();
            const res = await fetch('/api/users/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
              body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (data.success) {
              showToast(`🗑️ User @${username} removed from local DB and Firebase.`, 'info');
              loadUsersList();
              checkDashboardUserAuth();
            } else {
              showToast(data.error || 'Failed to remove user.', 'error');
            }
          } catch (err) {
            showToast('Network error deleting user.', 'error');
          }
          return;
        }
      });
    }

    // 16. Edit User Modal Actions & Form Submission (Auto-syncs with Firebase)
    if (editUserCloseBtn && editUserModal) {
      editUserCloseBtn.addEventListener('click', () => editUserModal.classList.add('hidden'));
    }
    if (editUserCancelBtn && editUserModal) {
      editUserCancelBtn.addEventListener('click', () => editUserModal.classList.add('hidden'));
    }
    if (editUserModal) {
      editUserModal.addEventListener('click', (e) => {
        if (e.target === editUserModal) editUserModal.classList.add('hidden');
      });
    }
    if (editUserForm) {
      editUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editUserTargetId ? editUserTargetId.value : '';
        const name = editUserNameInput ? editUserNameInput.value.trim() : '';
        const email = editUserEmailInput ? editUserEmailInput.value.trim().toLowerCase() : '';
        const role = editUserRoleSelect ? editUserRoleSelect.value : 'viewer';
        const status = editUserStatusSelect ? editUserStatusSelect.value : 'active';

        if (!id) return;

        try {
          const token = getAuthToken();
          const res = await fetch('/api/users/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
            body: JSON.stringify({ id, name, email, role, status })
          });
          const data = await res.json();
          if (data.success) {
            showToast('✅ User updated and synced with Firebase!', 'success');
            if (editUserModal) editUserModal.classList.add('hidden');
            loadUsersList();
            checkDashboardUserAuth();
          } else {
            showToast(data.error || 'Failed to update user.', 'error');
          }
        } catch (err) {
          showToast('Network error updating user.', 'error');
        }
      });
    }
  }

  // Helper: Convert VAPID base64 public key to Uint8Array
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  let swRegistrationInstance = null;
  async function subscribeToClosedBrowserPush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const reg = swRegistrationInstance || await navigator.serviceWorker.ready;
      if (!reg || !reg.pushManager) return;

      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
      }

      const res = await fetch('/api/push/vapid-public-key');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.publicKey) return;

      const convertedVapidKey = urlBase64ToUint8Array(data.publicKey);
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });
      }

      if (subscription) {
        const token = getAuthToken();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            subscription: subscription.toJSON()
          })
        });
        console.log('[WebPush] 🚀 Closed-browser Web Push subscription active!');
      }
    } catch (e) {
      console.warn('[WebPush] Push subscription warning:', e.message);
    }
  }

  // ----------------------------------------------------
  // 14. Live Train GPS & Delay Radar Tracker Module
  // ----------------------------------------------------
  function setupLiveTrainAutocomplete() {
    if (!liveTrackerSearchInput || !liveTrackerSearchDropdown) return;

    function renderTrainDropdown() {
      const q = (liveTrackerSearchInput.value || '').trim().toLowerCase();
      const allTrains = state.liveTrackerTrains || [];

      let matches = [];
      if (!q) {
        // Show initial prominent active trains
        matches = allTrains.slice(0, 10);
      } else {
        matches = allTrains.filter(t => {
          const name = (t.train_name || '').toLowerCase();
          const no = String(t.train_no || '');
          const from = (t.from || '').toLowerCase();
          const to = (t.to || '').toLowerCase();
          return name.includes(q) || no.includes(q) || from.includes(q) || to.includes(q);
        }).slice(0, 12);
      }

      if (matches.length === 0) {
        liveTrackerSearchDropdown.innerHTML = `
          <div class="px-4 py-3 text-xs text-slate-400 text-center font-medium">
            No matching running train found for "${escapeHtml(q)}"
          </div>
        `;
        liveTrackerSearchDropdown.classList.remove('hidden');
        return;
      }

      liveTrackerSearchDropdown.innerHTML = matches.map(t => {
        const delayMin = t.delay_minutes || 0;
        const isOntime = delayMin <= 10;
        const delayClass = isOntime ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
        const delayText = isOntime && delayMin === 0 ? '🟢 On Time' : `🟡 +${delayMin}m`;

        return `
          <div class="live-train-auto-item px-3.5 py-2.5 hover:bg-cyan-50/70 dark:hover:bg-cyan-950/40 cursor-pointer flex items-center justify-between gap-2 text-xs transition group" data-name="${escapeHtml(t.train_name)}" data-no="${t.train_no}">
            <div class="flex items-center space-x-2.5 min-w-0">
              <div class="w-6 h-6 rounded-lg bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 flex items-center justify-center text-[10px] shrink-0">
                <i class="fa-solid fa-train"></i>
              </div>
              <div class="min-w-0">
                <div class="flex items-center space-x-1.5">
                  <span class="font-extrabold text-slate-900 dark:text-white group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors truncate">${escapeHtml(t.train_name)}</span>
                  <span class="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">#${t.train_no}</span>
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtml(t.from)} ➔ ${escapeHtml(t.to)} (${t.departure_time || '--:--'})</div>
              </div>
            </div>
            <div class="text-right shrink-0">
              <span class="text-[10px] font-extrabold ${delayClass}">${delayText}</span>
            </div>
          </div>
        `;
      }).join('');

      liveTrackerSearchDropdown.querySelectorAll('.live-train-auto-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.dataset.name;
          liveTrackerSearchInput.value = name;
          state.liveTrackerSearchQuery = name.toLowerCase();
          if (clearLiveTrackerSearchBtn) clearLiveTrackerSearchBtn.classList.remove('hidden');
          liveTrackerSearchDropdown.classList.add('hidden');
          filterAndRenderLiveTrains();
        });
      });

      liveTrackerSearchDropdown.classList.remove('hidden');
    }

    liveTrackerSearchInput.addEventListener('input', (e) => {
      state.liveTrackerSearchQuery = e.target.value.trim().toLowerCase();
      if (clearLiveTrackerSearchBtn) clearLiveTrackerSearchBtn.classList.toggle('hidden', !state.liveTrackerSearchQuery);
      renderTrainDropdown();
      filterAndRenderLiveTrains();
    });

    liveTrackerSearchInput.addEventListener('focus', () => {
      renderTrainDropdown();
    });

    if (clearLiveTrackerSearchBtn) {
      clearLiveTrackerSearchBtn.addEventListener('click', () => {
        liveTrackerSearchInput.value = '';
        state.liveTrackerSearchQuery = '';
        clearLiveTrackerSearchBtn.classList.add('hidden');
        liveTrackerSearchDropdown.classList.add('hidden');
        filterAndRenderLiveTrains();
      });
    }

    document.addEventListener('click', (e) => {
      if (!liveTrackerSearchInput.contains(e.target) && !liveTrackerSearchDropdown.contains(e.target)) {
        liveTrackerSearchDropdown.classList.add('hidden');
      }
    });
  }

  function setupLiveRouteStationAutocomplete(inputEl, dropdownEl, clearBtn, onSelect) {
    if (!inputEl || !dropdownEl) return;

    function renderStationDropdown() {
      const q = (inputEl.value || '').trim().toLowerCase();
      const stationList = state.stations || [];

      let matches = [];
      if (!q) {
        // Show prominent junction stations by default
        const topStations = ['Dhaka', 'Chattogram', 'Sylhet', 'Rajshahi', 'Cox\'s Bazar', 'Khulna', 'Biman_Bandar', 'Santahar', 'Cumilla', 'Mymensingh'];
        matches = stationList.filter(s => topStations.some(ts => s.name.toLowerCase() === ts.toLowerCase())).slice(0, 10);
        if (matches.length === 0) matches = stationList.slice(0, 10);
      } else {
        // Check aliases first
        let aliasMatches = [];
        if (typeof STATION_ALIASES !== 'undefined' && STATION_ALIASES[q]) {
          const canonical = STATION_ALIASES[q];
          const sObj = stationList.find(s => s.name.toLowerCase() === canonical.toLowerCase());
          if (sObj) aliasMatches.push(sObj);
        }

        const otherMatches = stationList.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.display_name && s.display_name.toLowerCase().includes(q)) ||
          (s.bn_name && s.bn_name.includes(q)) ||
          (s.alias && s.alias.toLowerCase().includes(q))
        );

        matches = Array.from(new Set([...aliasMatches, ...otherMatches])).slice(0, 12);
      }

      if (matches.length === 0) {
        dropdownEl.innerHTML = `
          <div class="px-4 py-3 text-xs text-slate-400 text-center font-medium">
            No matching station found for "${escapeHtml(q)}"
          </div>
        `;
        dropdownEl.classList.remove('hidden');
        return;
      }

      dropdownEl.innerHTML = matches.map(s => {
        const displayName = s.display_name || s.name.replace(/_/g, ' ');
        const cleanVal = s.name.replace(/_/g, ' ');

        return `
          <div class="live-station-auto-item px-3.5 py-2.5 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 cursor-pointer flex items-center justify-between text-xs transition group" data-name="${escapeHtml(cleanVal)}">
            <div class="flex items-center space-x-2.5 min-w-0">
              <i class="fa-solid fa-location-dot text-emerald-500 text-xs shrink-0"></i>
              <div class="min-w-0">
                <span class="font-extrabold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">${escapeHtml(displayName)}</span>
                ${s.bn_name ? `<span class="text-slate-400 font-normal ml-1">(${escapeHtml(s.bn_name)})</span>` : ''}
              </div>
            </div>
            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold">${escapeHtml(s.name)}</span>
          </div>
        `;
      }).join('');

      dropdownEl.querySelectorAll('.live-station-auto-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.dataset.name;
          inputEl.value = name;
          if (clearBtn) clearBtn.classList.remove('hidden');
          dropdownEl.classList.add('hidden');
          onSelect(name);
          filterAndRenderLiveTrains();
        });
      });

      dropdownEl.classList.remove('hidden');
    }

    inputEl.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      if (clearBtn) clearBtn.classList.toggle('hidden', !val);
      onSelect(val);
      renderStationDropdown();
      filterAndRenderLiveTrains();
    });

    inputEl.addEventListener('focus', () => {
      renderStationDropdown();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        inputEl.value = '';
        clearBtn.classList.add('hidden');
        dropdownEl.classList.add('hidden');
        onSelect('');
        filterAndRenderLiveTrains();
      });
    }

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        dropdownEl.classList.add('hidden');
      }
    });
  }

  function initLiveTrackerModule() {
    // Navigation Tabs Switching (Top Nav)
    if (navSeatFinderBtn) {
      navSeatFinderBtn.addEventListener('click', () => switchMainTab('seats'));
    }
    if (navAutoBookBtn) {
      navAutoBookBtn.addEventListener('click', () => switchMainTab('autobook'));
    }
    if (navLiveTrackerBtn) {
      navLiveTrackerBtn.addEventListener('click', () => switchMainTab('tracker'));
    }

    // Mobile Bottom Navigation Bar — wired to same actions as top nav
    const mobileNavSeatFinderBtn = document.getElementById('mobileNavSeatFinderBtn');
    const mobileNavAutoBookBtn   = document.getElementById('mobileNavAutoBookBtn');
    const mobileNavLiveRadarBtn  = document.getElementById('mobileNavLiveRadarBtn');
    const mobileNavRoutesBtn     = document.getElementById('mobileNavRoutesBtn');
    const mobileNavWatchlistBtn  = document.getElementById('mobileNavWatchlistBtn');
    const mobileNavNotifBtn      = document.getElementById('mobileNavNotifBtn');

    if (mobileNavSeatFinderBtn) {
      mobileNavSeatFinderBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchMainTab('seats');
      });
    }
    if (mobileNavAutoBookBtn) {
      mobileNavAutoBookBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchMainTab('autobook');
      });
    }
    if (mobileNavLiveRadarBtn) {
      mobileNavLiveRadarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        switchMainTab('tracker');
      });
    }
    if (mobileNavRoutesBtn) {
      mobileNavRoutesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.getElementById('openRouteExplorerBtn');
        if (btn) btn.click();
      });
    }
    if (mobileNavWatchlistBtn) {
      mobileNavWatchlistBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.getElementById('openWatchlistBtn');
        if (btn) btn.click();
      });
    }
    if (mobileNavNotifBtn) {
      mobileNavNotifBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (notifDropdown) {
          const isHidden = notifDropdown.classList.contains('hidden');
          if (settingsDropdown) settingsDropdown.classList.add('hidden');
          if (isHidden) {
            notifDropdown.classList.remove('hidden');
            state.notifications.forEach(n => n.isRead = true);
            saveStoredNotifications();
            updateNotificationUI();
          } else {
            notifDropdown.classList.add('hidden');
          }
        } else {
          const btn = document.getElementById('notifBellBtn');
          if (btn) btn.click();
        }
      });
    }

    // Sync mobile bottom nav watchlist badge whenever the top badge updates
    const topWatchlistBadge = document.getElementById('watchlistBadge');
    const mobileWatchlistBadge = document.getElementById('mobileWatchlistBadge');
    const topNotifBadge = document.getElementById('notifBadge');
    const mobileNotifBadge = document.getElementById('mobileNotifBadge');
    if (topWatchlistBadge && mobileWatchlistBadge) {
      new MutationObserver(() => {
        const count = topWatchlistBadge.textContent.trim();
        mobileWatchlistBadge.textContent = count;
        mobileWatchlistBadge.classList.toggle('hidden', topWatchlistBadge.classList.contains('hidden') || !count || count === '0');
      }).observe(topWatchlistBadge, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    if (topNotifBadge && mobileNotifBadge) {
      new MutationObserver(() => {
        const count = topNotifBadge.textContent.trim();
        mobileNotifBadge.textContent = count;
        mobileNotifBadge.classList.toggle('hidden', topNotifBadge.classList.contains('hidden') || !count || count === '0');
      }).observe(topNotifBadge, { childList: true, attributes: true, attributeFilter: ['class'] });
    }

    // Auto-activate tab from URL hash (e.g. #autobook, #tracker, #seats) or query param ?tab=autobook
    const urlParams = new URLSearchParams(window.location.search);
    const initialTab = (window.location.hash.replace('#', '') || urlParams.get('tab') || '').toLowerCase();
    if (initialTab === 'autobook' || initialTab === 'auto-book') {
      switchMainTab('autobook');
    } else if (initialTab === 'tracker' || initialTab === 'radar') {
      switchMainTab('tracker');
    } else {
      syncMobileBottomNav('seats');
    }

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '').toLowerCase();
      if (h === 'autobook' || h === 'auto-book') {
        switchMainTab('autobook');
      } else if (h === 'tracker' || h === 'radar') {
        switchMainTab('tracker');
      } else if (h === 'seats') {
        switchMainTab('seats');
      }
    });

    // Refresh Button
    if (refreshLiveTrackerBtn) {
      refreshLiveTrackerBtn.addEventListener('click', () => loadRunningTrains(true));
    }

    // Search Mode Tabs ("By Train" vs "By Route")
    if (liveSearchByTrainTab && liveSearchByRouteTab) {
      liveSearchByTrainTab.addEventListener('click', () => {
        state.liveSearchMode = 'train';
        liveSearchByTrainTab.className = 'px-3 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
        liveSearchByRouteTab.className = 'px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
        if (liveSearchByTrainContainer) liveSearchByTrainContainer.classList.remove('hidden');
        if (liveSearchByRouteContainer) liveSearchByRouteContainer.classList.add('hidden');
        filterAndRenderLiveTrains();
      });

      liveSearchByRouteTab.addEventListener('click', () => {
        state.liveSearchMode = 'route';
        liveSearchByRouteTab.className = 'px-3 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
        liveSearchByTrainTab.className = 'px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
        if (liveSearchByRouteContainer) liveSearchByRouteContainer.classList.remove('hidden');
        if (liveSearchByTrainContainer) liveSearchByTrainContainer.classList.add('hidden');
        filterAndRenderLiveTrains();
      });
    }

    // Setup Live Train Autocomplete Dropdown ("By Train")
    setupLiveTrainAutocomplete();

    // Setup Live Station Autocomplete Dropdowns ("By Route")
    setupLiveRouteStationAutocomplete(liveRouteFromInput, liveRouteFromDropdown, clearLiveRouteFromBtn, (name) => {
      state.liveRouteFrom = name.toLowerCase();
    });

    setupLiveRouteStationAutocomplete(liveRouteToInput, liveRouteToDropdown, clearLiveRouteToBtn, (name) => {
      state.liveRouteTo = name.toLowerCase();
    });

    // Filter Chips
    if (liveTrackerFilterChips) {
      liveTrackerFilterChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.live-filter-chip');
        if (!chip) return;
        const filter = chip.dataset.filter || 'all';
        state.liveTrackerFilter = filter;

        // Update active chip style
        liveTrackerFilterChips.querySelectorAll('.live-filter-chip').forEach(btn => {
          if (btn === chip) {
            btn.className = 'live-filter-chip px-2.5 py-1 rounded-xl text-xs font-extrabold transition bg-cyan-600 text-white shadow-2xs cursor-pointer';
          } else {
            btn.className = 'live-filter-chip px-2.5 py-1 rounded-xl text-xs font-extrabold transition bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer';
          }
        });

        filterAndRenderLiveTrains();
      });
    }

    // Main Live Tracker View Toggle (Grid vs Radar Map)
    if (liveTrackerGridTab && liveTrackerMapTab) {
      liveTrackerGridTab.addEventListener('click', () => {
        state.liveTrackerView = 'grid';
        liveTrackerGridTab.className = 'px-2.5 sm:px-3 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
        liveTrackerMapTab.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
        if (liveTrackerGrid) liveTrackerGrid.classList.remove('hidden');
        if (liveTrackerNetworkMapContainer) liveTrackerNetworkMapContainer.classList.add('hidden');
      });

      liveTrackerMapTab.addEventListener('click', () => {
        state.liveTrackerView = 'map';
        liveTrackerMapTab.className = 'px-2.5 sm:px-3 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
        liveTrackerGridTab.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
        if (liveTrackerGrid) liveTrackerGrid.classList.add('hidden');
        if (liveTrackerEmptyState) liveTrackerEmptyState.classList.add('hidden');
        if (liveTrackerNetworkMapContainer) {
          liveTrackerNetworkMapContainer.classList.remove('hidden');
          initOrUpdateNetworkMap(state.liveTrackerTrains || []);
          setTimeout(() => {
            if (liveNetworkLeafletMap) liveNetworkLeafletMap.invalidateSize();
          }, 150);
        }
      });
    }

    // Modal View Toggle (Timeline vs Live Route Map)
    if (liveModalTimelineTab && liveModalMapTab) {
      liveModalTimelineTab.addEventListener('click', () => {
        state.liveModalView = 'timeline';
        liveModalTimelineTab.className = 'px-2.5 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
        liveModalMapTab.className = 'px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
        if (liveModalTimelineContainer) liveModalTimelineContainer.classList.remove('hidden');
        if (liveModalMapContainer) liveModalMapContainer.classList.add('hidden');
        if (liveModalCenterTrainBtn) liveModalCenterTrainBtn.classList.add('hidden');
      });

      liveModalMapTab.addEventListener('click', () => {
        state.liveModalView = 'map';
        liveModalMapTab.className = 'px-2.5 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
        liveModalTimelineTab.className = 'px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
        if (liveModalTimelineContainer) liveModalTimelineContainer.classList.add('hidden');
        if (liveModalMapContainer) {
          liveModalMapContainer.classList.remove('hidden');
          if (liveModalCenterTrainBtn) liveModalCenterTrainBtn.classList.remove('hidden');
          if (state.currentModalTrainData) {
            initOrUpdateModalMap(state.currentModalTrainData);
          }
          setTimeout(() => {
            if (liveModalLeafletMap) liveModalLeafletMap.invalidateSize();
          }, 50);
          setTimeout(() => {
            if (liveModalLeafletMap) liveModalLeafletMap.invalidateSize();
          }, 200);
        }
      });
    }

    // In-Map Controls for Network Radar Map
    const liveNetworkFullscreenBtn = document.getElementById('liveNetworkFullscreenBtn');
    const liveNetworkFullscreenIcon = document.getElementById('liveNetworkFullscreenIcon');
    const liveNetworkRecenterBtn = document.getElementById('liveNetworkRecenterBtn');
    const liveNetworkZoomInBtn = document.getElementById('liveNetworkZoomInBtn');
    const liveNetworkZoomOutBtn = document.getElementById('liveNetworkZoomOutBtn');

    if (liveNetworkFullscreenBtn) {
      liveNetworkFullscreenBtn.addEventListener('click', () => {
        toggleElementFullscreen(liveTrackerNetworkMapContainer, liveNetworkFullscreenIcon, liveNetworkLeafletMap);
      });
    }
    if (liveNetworkRecenterBtn) {
      liveNetworkRecenterBtn.addEventListener('click', () => {
        if (liveNetworkLeafletMap) {
          if (liveNetworkMarkersGroup && liveNetworkMarkersGroup.getLayers().length > 0) {
            const group = new L.featureGroup(liveNetworkMarkersGroup.getLayers());
            liveNetworkLeafletMap.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 10 });
          } else {
            liveNetworkLeafletMap.setView([23.8103, 90.4125], 7.2, { animate: true });
          }
        }
      });
    }
    if (liveNetworkZoomInBtn) {
      liveNetworkZoomInBtn.addEventListener('click', () => {
        if (liveNetworkLeafletMap) liveNetworkLeafletMap.zoomIn();
      });
    }
    if (liveNetworkZoomOutBtn) {
      liveNetworkZoomOutBtn.addEventListener('click', () => {
        if (liveNetworkLeafletMap) liveNetworkLeafletMap.zoomOut();
      });
    }

    // In-Map Controls for Modal Route Map
    const liveModalMapFullscreenBtn = document.getElementById('liveModalMapFullscreenBtn');
    const liveModalMapFullscreenIcon = document.getElementById('liveModalMapFullscreenIcon');
    const liveModalMapAutoFollowBtn = document.getElementById('liveModalMapAutoFollowBtn');
    const liveModalMapAutoFollowIcon = document.getElementById('liveModalMapAutoFollowIcon');
    const liveModalMapFitRouteBtn = document.getElementById('liveModalMapFitRouteBtn');
    const liveModalMapZoomInBtn = document.getElementById('liveModalMapZoomInBtn');
    const liveModalMapZoomOutBtn = document.getElementById('liveModalMapZoomOutBtn');

    if (liveModalMapFullscreenBtn) {
      liveModalMapFullscreenBtn.addEventListener('click', () => {
        toggleElementFullscreen(liveModalMapContainer, liveModalMapFullscreenIcon, liveModalLeafletMap);
      });
    }
    if (liveModalMapAutoFollowBtn) {
      liveModalMapAutoFollowBtn.addEventListener('click', () => {
        state.modalMapAutoFollow = !state.modalMapAutoFollow;
        if (state.modalMapAutoFollow) {
          liveModalMapAutoFollowBtn.className = 'w-8 h-8 rounded-xl bg-cyan-600 text-white hover:bg-cyan-700 backdrop-blur-md border border-cyan-500 shadow-md ring-2 ring-cyan-400/50 flex items-center justify-center text-xs transition cursor-pointer active:scale-95';
          if (liveModalLeafletMap && state.currentModalTrainMarker) {
            liveModalLeafletMap.setView(state.currentModalTrainMarker.getLatLng(), 11, { animate: true });
          }
        } else {
          liveModalMapAutoFollowBtn.className = 'w-8 h-8 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-cyan-600 hover:text-white text-slate-700 dark:text-slate-200 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md flex items-center justify-center text-xs transition cursor-pointer active:scale-95';
        }
      });
    }
    if (liveModalMapFitRouteBtn) {
      liveModalMapFitRouteBtn.addEventListener('click', () => {
        state.modalMapAutoFollow = false;
        if (liveModalMapAutoFollowBtn) {
          liveModalMapAutoFollowBtn.className = 'w-8 h-8 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-cyan-600 hover:text-white text-slate-700 dark:text-slate-200 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md flex items-center justify-center text-xs transition cursor-pointer active:scale-95';
        }
        if (liveModalLeafletMap && state.currentModalRouteBounds) {
          liveModalLeafletMap.fitBounds(state.currentModalRouteBounds, { padding: [35, 35] });
        }
      });
    }
    if (liveModalMapZoomInBtn) {
      liveModalMapZoomInBtn.addEventListener('click', () => {
        if (liveModalLeafletMap) liveModalLeafletMap.zoomIn();
      });
    }
    if (liveModalMapZoomOutBtn) {
      liveModalMapZoomOutBtn.addEventListener('click', () => {
        if (liveModalLeafletMap) liveModalLeafletMap.zoomOut();
      });
    }

    // Modal Close Handlers
    if (closeLiveTrainModalBtn) {
      closeLiveTrainModalBtn.addEventListener('click', () => {
        if (liveTrainModal) liveTrainModal.classList.add('hidden');
      });
    }
    if (refreshLiveTrainModalBtn) {
      refreshLiveTrainModalBtn.addEventListener('click', () => {
        if (state.currentLiveModalTrainNo) {
          openLiveTrainModal(state.currentLiveModalTrainNo, true);
        }
      });
    }
    if (liveTrainModal) {
      liveTrainModal.addEventListener('click', (e) => {
        if (e.target === liveTrainModal) {
          liveTrainModal.classList.add('hidden');
        }
      });
    }

    // Delegate Click for Live Train Cards
    document.addEventListener('click', (e) => {
      const liveBtn = e.target.closest('.view-live-train-btn');
      if (liveBtn) {
        const trainNo = liveBtn.dataset.trainNo;
        if (trainNo) openLiveTrainModal(trainNo);
      }
    });
  }


  function syncMobileBottomNav(tab) {
    const tabMap = {
      seats: 'mobileNavSeatFinderBtn',
      autobook: 'mobileNavAutoBookBtn',
      tracker: 'mobileNavLiveRadarBtn'
    };
    document.querySelectorAll('.mobile-bottom-nav-btn').forEach(btn => {
      btn.classList.remove('active-tab');
      const ind = btn.querySelector('.mobile-nav-indicator');
      if (ind) ind.classList.add('hidden');
    });
    const activeId = tabMap[tab];
    if (activeId) {
      const activeBtn = document.getElementById(activeId);
      if (activeBtn) {
        activeBtn.classList.add('active-tab');
        const ind = activeBtn.querySelector('.mobile-nav-indicator');
        if (ind) ind.classList.remove('hidden');
      }
    }
  }

  function switchMainTab(tab) {
    state.activeMainTab = tab;
    syncMobileBottomNav(tab);

    try {
      const currentHash = window.location.hash.replace('#', '');
      if (currentHash !== tab) {
        history.replaceState(null, null, '#' + tab);
      }
    } catch (e) {}

    const autoBookSection = document.getElementById('autoBookSection');

    if (tab === 'autobook') {
      if (seatFinderSection) seatFinderSection.classList.add('hidden');
      if (liveTrackerSection) liveTrackerSection.classList.add('hidden');
      if (autoBookSection) autoBookSection.classList.remove('hidden');

      if (navSeatFinderBtn) {
        navSeatFinderBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (navLiveTrackerBtn) {
        navLiveTrackerBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (navAutoBookBtn) {
        navAutoBookBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
    } else if (tab === 'tracker') {
      if (seatFinderSection) seatFinderSection.classList.add('hidden');
      if (autoBookSection) autoBookSection.classList.add('hidden');
      if (liveTrackerSection) liveTrackerSection.classList.remove('hidden');

      if (navSeatFinderBtn) {
        navSeatFinderBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (navAutoBookBtn) {
        navAutoBookBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (navLiveTrackerBtn) {
        navLiveTrackerBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }

      // Default to Grid View when opening Live Radar
      state.liveTrackerView = 'grid';
      if (liveTrackerGridTab) {
        liveTrackerGridTab.className = 'px-2.5 sm:px-3 py-1 rounded-lg bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs transition flex items-center space-x-1.5 cursor-pointer';
      }
      if (liveTrackerMapTab) {
        liveTrackerMapTab.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition flex items-center space-x-1.5 cursor-pointer';
      }
      if (liveTrackerGrid) liveTrackerGrid.classList.remove('hidden');
      if (liveTrackerNetworkMapContainer) liveTrackerNetworkMapContainer.classList.add('hidden');

      loadRunningTrains(false);
    } else {
      if (liveTrackerSection) liveTrackerSection.classList.add('hidden');
      if (autoBookSection) autoBookSection.classList.add('hidden');
      if (seatFinderSection) seatFinderSection.classList.remove('hidden');

      if (navSeatFinderBtn) {
        navSeatFinderBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (navAutoBookBtn) {
        navAutoBookBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (navLiveTrackerBtn) {
        navLiveTrackerBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
    }
  }

  function updateLiveTrackerFilterChipCounts(trains) {
    if (!liveTrackerFilterChips) return;
    const counts = {
      all: trains.length,
      ontime: 0,
      delayed: 0,
      scheduled: 0,
      nodata: 0,
      completed: 0
    };
    trains.forEach(t => {
      const p = t.progress_pct || 0;
      const s = t.status;
      if (s === 'completed' || s === 'arrived' || p >= 100) counts.completed++;
      else if (s === 'nodata' || (t.delay_text || '').toLowerCase().includes('no data')) counts.nodata++;
      else if (s === 'scheduled' || p === 0) counts.scheduled++;
      else if ((t.delay_minutes || 0) > 10) counts.delayed++;
      else counts.ontime++;
    });

    const labels = {
      all: `All (${counts.all})`,
      ontime: `🟢 On time (${counts.ontime})`,
      delayed: `🟡 Delayed (${counts.delayed})`,
      scheduled: `⏱️ Scheduled (${counts.scheduled})`,
      nodata: `⚪ No data (${counts.nodata})`,
      completed: `🏁 Completed (${counts.completed})`
    };

    liveTrackerFilterChips.querySelectorAll('.live-filter-chip').forEach(btn => {
      const f = btn.dataset.filter;
      if (labels[f]) btn.textContent = labels[f];
    });
  }

  let liveNetworkLeafletMap = null;
  let liveNetworkMarkersGroup = null;
  let liveModalLeafletMap = null;
  let liveModalMapLayerGroup = null;
  // Dedicated map for smooth-animated train beacon markers (not cleared on each refresh)
  let liveTrainBeaconMap = new Map(); // train_no → L.marker


  function toggleElementFullscreen(el, iconEl, mapInstance) {
    if (!el) return;
    const isFull = document.fullscreenElement === el || el.classList.contains('fixed-map-fullscreen');

    if (!isFull) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {
          el.classList.add('fixed', 'inset-0', 'z-[9999]', 'w-screen', 'h-screen', 'fixed-map-fullscreen');
        });
      } else {
        el.classList.add('fixed', 'inset-0', 'z-[9999]', 'w-screen', 'h-screen', 'fixed-map-fullscreen');
      }
      if (iconEl) {
        iconEl.classList.remove('fa-expand');
        iconEl.classList.add('fa-compress');
      }
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      el.classList.remove('fixed', 'inset-0', 'z-[9999]', 'w-screen', 'h-screen', 'fixed-map-fullscreen');
      if (iconEl) {
        iconEl.classList.remove('fa-compress');
        iconEl.classList.add('fa-expand');
      }
    }

    setTimeout(() => {
      if (mapInstance) mapInstance.invalidateSize();
    }, 250);
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      document.querySelectorAll('.fixed-map-fullscreen').forEach(el => {
        el.classList.remove('fixed', 'inset-0', 'z-[9999]', 'w-screen', 'h-screen', 'fixed-map-fullscreen');
      });
      const netIcon = document.getElementById('liveNetworkFullscreenIcon');
      if (netIcon) {
        netIcon.classList.remove('fa-compress');
        netIcon.classList.add('fa-expand');
      }
      const modalIcon = document.getElementById('liveModalMapFullscreenIcon');
      if (modalIcon) {
        modalIcon.classList.remove('fa-compress');
        modalIcon.classList.add('fa-expand');
      }
      if (liveNetworkLeafletMap) liveNetworkLeafletMap.invalidateSize();
      if (liveModalLeafletMap) liveModalLeafletMap.invalidateSize();
    }
  });


  // Smoothly animate a Leaflet marker to a new [lat, lng] over durationMs milliseconds
  function animateLeafletMarker(marker, newLatLng, durationMs = 2800) {
    if (!marker) return;
    const start = marker.getLatLng();
    const startLat = start.lat, startLng = start.lng;
    const endLat = newLatLng[0], endLng = newLatLng[1];
    if (Math.abs(startLat - endLat) < 0.00001 && Math.abs(startLng - endLng) < 0.00001) return;
    const startTime = performance.now();
    const easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const e = easeInOut(t);
      marker.setLatLng([startLat + (endLat - startLat) * e, startLng + (endLng - startLng) * e]);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Convert bearing degrees to an 8-point compass label
  function compassDir(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }

  function calculateBearing(p1, p2) {
    if (!p1 || !p2 || (p1[0] === p2[0] && p1[1] === p2[1])) return 0;
    const lat1 = (p1[0] * Math.PI) / 180;
    const lon1 = (p1[1] * Math.PI) / 180;
    const lat2 = (p2[0] * Math.PI) / 180;
    const lon2 = (p2[1] * Math.PI) / 180;
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  function snapPointToTrack(pt, trackPoints) {
    if (!pt || !trackPoints || trackPoints.length === 0) return pt;
    if (trackPoints.length === 1) return trackPoints[0];
    let minD = Infinity;
    let bestPt = pt;
    for (let i = 0; i < trackPoints.length - 1; i++) {
      const p1 = trackPoints[i];
      const p2 = trackPoints[i + 1];
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const lenSq = dx * dx + dy * dy;
      let proj;
      if (lenSq === 0) {
        proj = p1;
      } else {
        const u = Math.max(0, Math.min(1, ((pt[0] - p1[0]) * dx + (pt[1] - p1[1]) * dy) / lenSq));
        proj = [p1[0] + u * dx, p1[1] + u * dy];
      }
      const d = Math.hypot(proj[0] - pt[0], proj[1] - pt[1]);
      if (d < minD) {
        minD = d;
        bestPt = proj;
      }
    }
    return minD < 0.25 ? bestPt : pt;
  }

  async function drawAccurateTrainCurve(mapLayerGroup, from, to, fallbackCoords, fromCoords, toCoords, progressPct) {
    if (!mapLayerGroup) return null;
    let trackPoints = null;

    try {
      // 1. If waypoints (multiple stoppages) are available, request full track geometry
      if (Array.isArray(fallbackCoords) && fallbackCoords.length >= 2) {
        const res = await fetch('/api/live-tracker/rail-curve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: from || '',
            to: to || '',
            waypoints: fallbackCoords
          })
        });
        const json = await res.json();
        if (json && json.success && Array.isArray(json.coordinates) && json.coordinates.length > 1) {
          trackPoints = json.coordinates;
        }
      }

      // 2. Query with from/to station names and GPS coordinates
      if (!trackPoints && (from || fromCoords) && (to || toCoords)) {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (fromCoords && fromCoords[0] && fromCoords[1]) {
          params.set('from_lat', fromCoords[0]);
          params.set('from_lng', fromCoords[1]);
        }
        if (toCoords && toCoords[0] && toCoords[1]) {
          params.set('to_lat', toCoords[0]);
          params.set('to_lng', toCoords[1]);
        }
        const res = await fetch(`/api/live-tracker/rail-curve?${params.toString()}`);
        const json = await res.json();
        if (json && json.success && Array.isArray(json.coordinates) && json.coordinates.length > 1) {
          trackPoints = json.coordinates;
        }
      }
    } catch (e) {
      console.warn('[RailCurve] fetch curve error:', e.message);
    }

    if (trackPoints && trackPoints.length > 1) {
      const pct = (progressPct !== null && progressPct !== undefined && progressPct >= 0 && progressPct <= 100) ? progressPct : null;

      if (pct !== null && pct > 0) {
        // Split polyline into completed (grey) and remaining (cyan glow) segments
        const splitIdx = Math.max(1, Math.min(trackPoints.length - 1, Math.round(trackPoints.length * pct / 100)));
        const completedPts = trackPoints.slice(0, splitIdx + 1);
        const remainingPts = trackPoints.slice(splitIdx);

        // Completed segment — single clean grey line
        if (completedPts.length > 1) {
          mapLayerGroup.addLayer(L.polyline(completedPts, {
            color: '#64748b', weight: 3, opacity: 0.65, smoothFactor: 0, noClip: true, lineCap: 'round', lineJoin: 'round'
          }));
        }
        // Remaining segment — single clean glowing cyan line
        if (remainingPts.length > 1) {
          mapLayerGroup.addLayer(L.polyline(remainingPts, {
            color: '#06b6d4', weight: 3.5, opacity: 0.95, smoothFactor: 0, noClip: true, lineCap: 'round', lineJoin: 'round'
          }));
        }
      } else {
        // No progress data — render single clean cyan line
        mapLayerGroup.addLayer(L.polyline(trackPoints, {
          color: '#06b6d4', weight: 3.5, opacity: 0.95, smoothFactor: 0, noClip: true, lineCap: 'round', lineJoin: 'round'
        }));
      }
    }
    return trackPoints;
  }


  const BANGLADESH_MAP_BOUNDS = [[20.25, 87.75], [26.90, 92.95]];

  function initOrUpdateNetworkMap(trains) {
    if (!window.L || !document.getElementById('liveNetworkLeafletMap')) return;

    if (!liveNetworkLeafletMap) {
      liveNetworkLeafletMap = L.map('liveNetworkLeafletMap', {
        center: [23.8103, 90.4125],
        zoom: 7.2,
        minZoom: 6.8,
        maxZoom: 18,
        maxBounds: BANGLADESH_MAP_BOUNDS,
        maxBoundsViscosity: 1.0,
        zoomControl: false,
        attributionControl: true
      });

      // Google Maps Layer with User API Key & Railway Transit Highlights
      const isDark = document.documentElement.classList.contains('dark');
      if (window.L && L.gridLayer && typeof L.gridLayer.googleMutant === 'function') {
        L.gridLayer.googleMutant({
          type: 'roadmap',
          styles: isDark ? [
            { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#1e293b' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
            { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#06b6d4' }, { weight: 2 }] },
            { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#0284c7' }] },
            { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#38bdf8' }] },
            { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] }
          ] : [
            { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#0284c7' }, { weight: 2.5 }] },
            { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#0369a1' }] },
            { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#0369a1' }] },
            { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] }
          ]
        }).addTo(liveNetworkLeafletMap);
      } else {
        L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
          maxZoom: 20,
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
          attribution: '&copy; Google Maps'
        }).addTo(liveNetworkLeafletMap);
      }

      liveNetworkMarkersGroup = L.layerGroup().addTo(liveNetworkLeafletMap);
    }

    if (!liveNetworkMarkersGroup) return;
    liveNetworkMarkersGroup.clearLayers(); // clears curves and station markers only

    // Remove beacon markers for trains no longer in this update
    const activeTrNos = new Set((trains || []).filter(t => (t.current_coords?.[0] || t.from_coords?.[0])).map(t => String(t.train_no)));
    for (const [trNo, bm] of liveTrainBeaconMap.entries()) {
      if (!activeTrNos.has(trNo)) {
        liveNetworkLeafletMap.removeLayer(bm);
        liveTrainBeaconMap.delete(trNo);
      }
    }

    const bounds = [];
    const isSingleSelectedTrain = (trains || []).length === 1;
    const drawnCorridors = new Set();

    (trains || []).forEach(async t => {
      let latLng = t.current_coords;
      if (!latLng || !latLng[0] || !latLng[1]) {
        latLng = t.from_coords;
      }
      if (!latLng || !latLng[0] || !latLng[1]) return;

      bounds.push(latLng);

      // Compute travel heading bearing
      const bearing = (t.from_coords && t.to_coords)
        ? calculateBearing(latLng || t.from_coords, t.to_coords)
        : (t.from_coords && latLng ? calculateBearing(t.from_coords, latLng) : 0);
      const dirLabel = compassDir(bearing);

      // In individual train mode or filtered route mode, draw single progress-split route + snapped station pins
      if (t.from_coords && t.to_coords && t.from_coords[0] && t.to_coords[0]) {
        const corridorKey = `${t.from}->${t.to}`;
        if (isSingleSelectedTrain || (trains.length <= 4 && state.liveSearchMode === 'route' && !drawnCorridors.has(corridorKey))) {
          drawnCorridors.add(corridorKey);
          bounds.push(t.from_coords);
          bounds.push(t.to_coords);

          const trackPoints = await drawAccurateTrainCurve(liveNetworkMarkersGroup, t.from, t.to, null, t.from_coords, t.to_coords, t.progress_pct);
          if (trackPoints && trackPoints.length > 0) {
            latLng = snapPointToTrack(latLng, trackPoints);
          }
          const fromPos = snapPointToTrack(t.from_coords, trackPoints);
          const toPos = snapPointToTrack(t.to_coords, trackPoints);

          const fromDot = L.circleMarker(fromPos, {
            radius: 7, fillColor: '#10b981', color: '#ffffff', weight: 2.5, fillOpacity: 1
          }).bindTooltip(`🚉 Origin: ${escapeHtml(t.from)}`, { permanent: true, direction: 'top', className: 'text-xs font-bold shadow-md' });
          liveNetworkMarkersGroup.addLayer(fromDot);

          const toDot = L.circleMarker(toPos, {
            radius: 7, fillColor: '#f43f5e', color: '#ffffff', weight: 2.5, fillOpacity: 1
          }).bindTooltip(`🏁 Destination: ${escapeHtml(t.to)}`, { permanent: true, direction: 'top', className: 'text-xs font-bold shadow-md' });
          liveNetworkMarkersGroup.addLayer(toDot);
        }
      }

      const delayMin = t.delay_minutes || 0;
      const status = t.status;
      let colorClass = 'bg-cyan-500';
      if (status === 'completed' || status === 'arrived') {
        colorClass = 'bg-slate-400';
      } else if (status === 'scheduled') {
        colorClass = 'bg-blue-500';
      } else if (delayMin > 10) {
        colorClass = 'bg-amber-500';
      } else {
        colorClass = 'bg-emerald-500';
      }

      const iconHtml = `
        <div class="relative flex items-center justify-center cursor-pointer group">
          <!-- Directional Heading Pointer Arrow -->
          <div class="absolute w-8 h-8 flex items-center justify-center pointer-events-none" style="transform: rotate(${Math.round(bearing)}deg);">
            <div class="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-cyan-400 -translate-y-4 filter drop-shadow-md"></div>
          </div>
          <!-- Main Train Badge -->
          <div class="w-7 h-7 rounded-full ${colorClass} text-white flex items-center justify-center text-[11px] shadow-xl ring-2 ring-white ring-offset-1 ring-offset-cyan-500/40 relative z-10 transition-transform group-hover:scale-110">
            <i class="fa-solid fa-train"></i>
          </div>
          <!-- Train Number Tag -->
          <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 font-mono text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-900/95 text-white shadow-md border border-slate-700 whitespace-nowrap pointer-events-none z-20">#${t.train_no}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-live-train-icon',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16]
      });

      const statusLabel = status === 'delayed' ? `🟡 Delay: +${delayMin}m` : (status === 'completed' ? '✅ Arrived' : (status === 'scheduled' ? '⏱ Scheduled' : '🟢 On Time'));
      const popupContent = `
        <div class="p-1 space-y-1.5 min-w-[185px] text-slate-800">
          <div class="font-black text-xs text-cyan-700 flex items-center justify-between gap-1">
            <span>${escapeHtml(t.train_name)}</span>
            <span class="font-mono text-[10px] px-1 rounded bg-slate-100 font-bold">#${t.train_no}</span>
          </div>
          <div class="text-[11px] font-bold text-slate-600 flex items-center gap-1">
            <span>${escapeHtml(t.from)}</span>
            <span class="text-cyan-500">➔</span>
            <span class="text-rose-600 font-black">${escapeHtml(t.to)}</span>
          </div>
          <div class="flex items-center gap-2 text-[10px] font-semibold pt-1 border-t border-slate-100">
            <span>${statusLabel}</span>
            <span class="font-mono font-bold text-slate-500">${t.progress_pct || 0}% done</span>
          </div>
          <div class="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
            <i class="fa-solid fa-location-arrow text-[9px] text-cyan-500"></i>
            <span>Heading <strong class="text-slate-700">${dirLabel}</strong> towards <strong class="text-rose-600">${escapeHtml(t.to)}</strong></span>
          </div>
          <button type="button" class="w-full mt-1 py-1 px-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-bold transition flex items-center justify-center gap-1 view-live-train-btn cursor-pointer" data-train-no="${t.train_no}">
            <i class="fa-solid fa-route text-[10px]"></i>
            <span>View Full Journey</span>
          </button>
        </div>
      `;

      const trKey = String(t.train_no);
      const existingBeacon = liveTrainBeaconMap.get(trKey);
      if (existingBeacon) {
        // Smoothly animate to new position, update icon & popup
        animateLeafletMarker(existingBeacon, latLng);
        existingBeacon.setIcon(customIcon);
        existingBeacon.setPopupContent(popupContent);
        if (isSingleSelectedTrain) {
          setTimeout(() => existingBeacon.openPopup(), 200);
        }
      } else {
        // First time — create and add beacon directly to map (not to markersGroup)
        const newMarker = L.marker(latLng, { icon: customIcon }).bindPopup(popupContent);
        newMarker.addTo(liveNetworkLeafletMap);
        liveTrainBeaconMap.set(trKey, newMarker);
        if (isSingleSelectedTrain) {
          setTimeout(() => newMarker.openPopup(), 200);
        }
      }
    });

    if (bounds.length > 0) {
      liveNetworkLeafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: isSingleSelectedTrain ? 11 : 10 });
    }
  }


  async function initOrUpdateModalMap(data) {
    if (!window.L || !document.getElementById('liveModalLeafletMap') || !data) return;

    if (!liveModalLeafletMap) {
      liveModalLeafletMap = L.map('liveModalLeafletMap', {
        center: [23.8103, 90.4125],
        zoom: 8,
        minZoom: 6.8,
        maxZoom: 18,
        maxBounds: BANGLADESH_MAP_BOUNDS,
        maxBoundsViscosity: 1.0,
        zoomControl: false,
        attributionControl: true
      });

      // Google Maps Layer with User API Key & Railway Transit Highlights
      const isDark = document.documentElement.classList.contains('dark');
      if (window.L && L.gridLayer && typeof L.gridLayer.googleMutant === 'function') {
        L.gridLayer.googleMutant({
          type: 'roadmap',
          styles: isDark ? [
            { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#1e293b' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
            { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#06b6d4' }, { weight: 2 }] },
            { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#0284c7' }] },
            { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#38bdf8' }] },
            { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] }
          ] : [
            { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#0284c7' }, { weight: 2.5 }] },
            { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#0369a1' }] },
            { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#0369a1' }] },
            { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] }
          ]
        }).addTo(liveModalLeafletMap);
      } else {
        L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
          maxZoom: 20,
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
          attribution: '&copy; Google Maps'
        }).addTo(liveModalLeafletMap);
      }

      liveModalMapLayerGroup = L.layerGroup().addTo(liveModalLeafletMap);
    }

    if (!liveModalMapLayerGroup) return;
    liveModalMapLayerGroup.clearLayers();

    const stoppages = data.stoppages || [];
    const rawCoords = [];

    stoppages.forEach((stop) => {
      if (stop.lat && stop.lng) {
        rawCoords.push([stop.lat, stop.lng]);
      }
    });

    // Render 100% Accurate Physical Rail Track Curve matching Google Maps
    const originStop = stoppages[0]?.station_name || data.from;
    const destStop = stoppages[stoppages.length - 1]?.station_name || data.to;
    const originCoord = (stoppages[0]?.lat && stoppages[0]?.lng) ? [stoppages[0].lat, stoppages[0].lng] : null;
    const destCoord = (stoppages[stoppages.length - 1]?.lat && stoppages[stoppages.length - 1]?.lng) ? [stoppages[stoppages.length - 1].lat, stoppages[stoppages.length - 1].lng] : null;
    const trackPoints = await drawAccurateTrainCurve(liveModalMapLayerGroup, originStop, destStop, rawCoords, originCoord, destCoord, data.progress_pct);

    const validCoords = [];
    stoppages.forEach((stop, idx) => {
      if (stop.lat && stop.lng) {
        const rawPt = [stop.lat, stop.lng];
        // Strictly snap stoppage station position to the physical railway track line
        const pt = snapPointToTrack(rawPt, trackPoints);
        validCoords.push(pt);

        const isOrigin = idx === 0;
        const isDest = idx === stoppages.length - 1;
        const isPassed = stop.status === 'passed' || stop.status === 'departed' || (data.prev_stop_idx >= 0 && idx <= data.prev_stop_idx);
        const isNext = stop.status === 'next' || stop.station_name === data.next_stop;

        let radius = 5;
        let fillColor = '#94a3b8';
        let strokeColor = '#ffffff';
        let weight = 2;
        let labelText = stop.station_name;

        if (isOrigin) {
          radius = 7.5;
          fillColor = '#10b981';
          strokeColor = '#ffffff';
          weight = 2.5;
          labelText = `🚉 ${stop.station_name} (Origin)`;
        } else if (isDest) {
          radius = 7.5;
          fillColor = '#f43f5e';
          strokeColor = '#ffffff';
          weight = 2.5;
          labelText = `🏁 ${stop.station_name} (Destination)`;
        } else if (isNext) {
          radius = 8;
          fillColor = '#06b6d4';
          strokeColor = '#ffffff';
          weight = 2.5;
          labelText = `🔵 Next: ${stop.station_name}`;

          // Pulsing radar halo marker on immediate next stop
          const pulseIcon = L.divIcon({
            html: `
              <div class="relative flex items-center justify-center pointer-events-none">
                <span class="absolute w-8 h-8 rounded-full bg-cyan-400/50 animate-ping"></span>
                <span class="w-3.5 h-3.5 rounded-full bg-cyan-500 ring-2 ring-white shadow-lg"></span>
              </div>
            `,
            className: 'custom-next-stop-pulse',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          });
          liveModalMapLayerGroup.addLayer(L.marker(pt, { icon: pulseIcon, interactive: false }));
        } else if (isPassed) {
          fillColor = '#10b981';
        }

        const circleMarker = L.circleMarker(pt, {
          radius: radius,
          fillColor: fillColor,
          color: strokeColor,
          weight: weight,
          opacity: 1,
          fillOpacity: 0.95
        }).bindPopup(`
          <div class="p-1.5 space-y-1.5 min-w-[200px] text-slate-800">
            <div class="flex items-center justify-between gap-1 pb-1 border-b border-slate-100">
              <span class="font-black text-xs text-cyan-800">🚉 ${escapeHtml(stop.station_name)}</span>
              <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${isPassed ? 'bg-emerald-100 text-emerald-700' : (isNext ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600')}">
                ${isOrigin ? 'Origin' : (isDest ? 'Destination' : (isNext ? 'Next Stop' : (isPassed ? 'Passed' : 'Upcoming')))}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-1 text-[10px] text-slate-600 font-bold">
              <div>Sched: <span class="font-mono text-slate-800">${stop.scheduled_time}</span></div>
              <div>${isPassed ? 'Actual' : 'ETA'}: <span class="font-mono ${isPassed ? 'text-emerald-700' : 'text-cyan-700'}">${isPassed ? (stop.actual_time || stop.scheduled_time) : (stop.eta_time || stop.scheduled_time)}</span></div>
            </div>
            <div class="flex items-center justify-between text-[9px] text-slate-400 font-mono pt-1 border-t border-slate-100">
              <span>${stop.distance_km} km from start</span>
              <span class="font-bold text-slate-600">${stop.platform && stop.platform !== '—' ? `Platform ${stop.platform}` : 'Platform --'}</span>
            </div>
          </div>
        `).bindTooltip(labelText, { permanent: isOrigin || isDest || isNext, direction: 'top', className: 'text-xs font-bold shadow-md' });

        liveModalMapLayerGroup.addLayer(circleMarker);
      }
    });

    // Determine current train position & direction bearing strictly on track
    let trainCoord = null;
    let modalBearing = 0;
    if (data.prev_stop_idx >= 0 && data.prev_stop_idx < stoppages.length - 1) {
      const prevStop = stoppages[data.prev_stop_idx];
      const nextStop = stoppages[data.prev_stop_idx + 1];
      if (prevStop?.lat && prevStop?.lng && nextStop?.lat && nextStop?.lng) {
        const segPct = Math.min(1, Math.max(0, (data.segment_progress_pct || 50) / 100));
        const rawTrainPt = [
          prevStop.lat + (nextStop.lat - prevStop.lat) * segPct,
          prevStop.lng + (nextStop.lng - prevStop.lng) * segPct
        ];
        trainCoord = snapPointToTrack(rawTrainPt, trackPoints);
        modalBearing = calculateBearing([prevStop.lat, prevStop.lng], [nextStop.lat, nextStop.lng]);
      }
    }
    if (!trainCoord && validCoords.length > 0) {
      const idx = Math.min(validCoords.length - 1, Math.max(0, data.prev_stop_idx >= 0 ? data.prev_stop_idx : 0));
      trainCoord = validCoords[idx];
      if (idx < validCoords.length - 1) {
        modalBearing = calculateBearing(validCoords[idx], validCoords[idx + 1]);
      }
    }

    if (validCoords.length > 0) {
      const routeBounds = L.latLngBounds(validCoords);
      if (trainCoord) routeBounds.extend(trainCoord);
      state.currentModalRouteBounds = routeBounds;

      if (!state.modalMapAutoFollow) {
        liveModalLeafletMap.fitBounds(routeBounds, { padding: [35, 35] });
      }
    }

    // Bind User Drag Listener to auto-disable camera lock
    if (!liveModalLeafletMap._hasDragListener) {
      liveModalLeafletMap._hasDragListener = true;
      liveModalLeafletMap.on('dragstart', () => {
        state.modalMapAutoFollow = false;
        const btn = document.getElementById('liveModalMapAutoFollowBtn');
        if (btn) btn.className = 'w-8 h-8 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-cyan-600 hover:text-white text-slate-700 dark:text-slate-200 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-md flex items-center justify-center text-xs transition cursor-pointer active:scale-95';
      });
    }

    // Auto-Follow Camera pan
    if (state.modalMapAutoFollow && trainCoord) {
      liveModalLeafletMap.setView(trainCoord, 11, { animate: true });
    }

    // Update In-Map Floating Telemetry HUD
    const modalHudStatusBadge = document.getElementById('modalHudStatusBadge');
    const modalHudSpeedText = document.getElementById('modalHudSpeedText');
    const modalHudNextStopText = document.getElementById('modalHudNextStopText');
    const modalHudDistanceEtaText = document.getElementById('modalHudDistanceEtaText');
    const modalHudBearingText = document.getElementById('modalHudBearingText');

    const delayMin = data.delay_minutes || 0;
    if (modalHudStatusBadge) {
      if (delayMin > 10) {
        modalHudStatusBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300';
        modalHudStatusBadge.textContent = `+${delayMin}m Delay`;
      } else {
        modalHudStatusBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300';
        modalHudStatusBadge.textContent = 'On Time';
      }
    }
    if (modalHudSpeedText) modalHudSpeedText.textContent = `${data.speed || 0} km/h`;
    if (modalHudNextStopText) modalHudNextStopText.textContent = data.next_stop || '—';
    if (modalHudDistanceEtaText) {
      const nextEta = data.next_eta || (stoppages.find(s => s.station_name === data.next_stop)?.eta_time || '--:--');
      modalHudDistanceEtaText.textContent = `${data.next_distance_km ? `${data.next_distance_km} km ahead • ` : ''}ETA ${nextEta}`;
    }
    if (modalHudBearingText) {
      modalHudBearingText.textContent = `${compassDir(modalBearing)} ${Math.round(modalBearing)}°`;
    }

    if (trainCoord) {
      const trainIconHtml = `
        <div class="relative flex items-center justify-center">
          <!-- Directional Heading Pointer Arrow -->
          <div class="absolute w-10 h-10 flex items-center justify-center pointer-events-none transition-transform duration-300" style="transform: rotate(${Math.round(modalBearing)}deg);">
            <div class="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[10px] border-b-cyan-300 -translate-y-5 filter drop-shadow-lg"></div>
          </div>
          <!-- Main Train Badge -->
          <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center text-xs shadow-2xl ring-2 ring-white ring-offset-2 ring-offset-cyan-400/50 animate-pulse relative z-10">
            <i class="fa-solid fa-train"></i>
          </div>
        </div>
      `;

      const trainMarker = L.marker(trainCoord, {
        icon: L.divIcon({
          html: trainIconHtml,
          className: 'custom-modal-train-beacon',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      }).bindPopup(`
        <div class="p-1.5 space-y-1 text-slate-800">
          <div class="font-black text-xs text-cyan-800">${escapeHtml(data.train_name)} #${data.train_no}</div>
          <div class="text-[10px] font-bold text-slate-600">Speed: ${data.speed || 0} km/h • Delay: +${data.delay_minutes || 0}m</div>
          <div class="text-[10px] font-bold text-cyan-600">Next: ${escapeHtml(data.next_stop)} (ETA ${data.next_eta || '--:--'})</div>
          <div class="text-[9px] font-bold text-slate-400 font-mono">Heading ${compassDir(modalBearing)} (${Math.round(modalBearing)}°)</div>
        </div>
      `);

      liveModalMapLayerGroup.addLayer(trainMarker);
      state.currentModalTrainMarker = trainMarker;
    }
  }

  async function loadRunningTrains(forceRefresh = false) {
    if (state.liveTrackerLoading) return;
    state.liveTrackerLoading = true;

    if (refreshLiveTrackerIcon) refreshLiveTrackerIcon.classList.add('fa-spin');
    if (liveTrackerLoadingState && (!state.liveTrackerTrains || state.liveTrackerTrains.length === 0)) {
      liveTrackerLoadingState.classList.remove('hidden');
      if (liveTrackerGrid) liveTrackerGrid.classList.add('hidden');
      if (liveTrackerEmptyState) liveTrackerEmptyState.classList.add('hidden');
    }

    try {
      const res = await fetch(`/api/live-tracker/running-trains${forceRefresh ? '?refresh=1' : ''}`);
      const data = await res.json();

      if (data && data.success && Array.isArray(data.trains) && data.trains.length > 0) {
        state.liveTrackerTrains = data.trains;
        if (liveTrackerCount) liveTrackerCount.textContent = data.trains.length;
        updateLiveTrackerFilterChipCounts(data.trains);
        filterAndRenderLiveTrains();
      } else if (state.liveTrackerTrains && state.liveTrackerTrains.length > 0) {
        // Retain existing loaded trains if temporary sync occurs
        updateLiveTrackerFilterChipCounts(state.liveTrackerTrains);
        filterAndRenderLiveTrains();
      } else {
        if (liveTrackerEmptyState) liveTrackerEmptyState.classList.remove('hidden');
        if (liveTrackerGrid) liveTrackerGrid.classList.add('hidden');
      }
    } catch (err) {
      console.warn('[LiveTracker] Load error:', err);
      if (!state.liveTrackerTrains || state.liveTrackerTrains.length === 0) {
        if (liveTrackerEmptyState) liveTrackerEmptyState.classList.remove('hidden');
        if (liveTrackerGrid) liveTrackerGrid.classList.add('hidden');
      }
    } finally {
      state.liveTrackerLoading = false;
      if (refreshLiveTrackerIcon) refreshLiveTrackerIcon.classList.remove('fa-spin');
      if (liveTrackerLoadingState) liveTrackerLoadingState.classList.add('hidden');
    }
  }

  function filterAndRenderLiveTrains() {
    if (!liveTrackerGrid) return;
    let list = state.liveTrackerTrains || [];

    // Filter by Search Mode ("route" vs "train")
    if (state.liveSearchMode === 'route') {
      if (state.liveRouteFrom) {
        const fromQ = state.liveRouteFrom;
        list = list.filter(t => (t.from || '').toLowerCase().includes(fromQ));
      }
      if (state.liveRouteTo) {
        const toQ = state.liveRouteTo;
        list = list.filter(t => (t.to || '').toLowerCase().includes(toQ));
      }
    } else {
      // By Train search
      if (state.liveTrackerSearchQuery) {
        const q = state.liveTrackerSearchQuery;
        list = list.filter(t => {
          const name = (t.train_name || '').toLowerCase();
          const no = String(t.train_no || '');
          const from = (t.from || '').toLowerCase();
          const to = (t.to || '').toLowerCase();
          return name.includes(q) || no.includes(q) || from.includes(q) || to.includes(q);
        });
      }
    }

    // Filter by chips (all, ontime, delayed, scheduled, nodata, completed)
    if (state.liveTrackerFilter === 'ontime') {
      list = list.filter(t => t.status === 'ontime' || ((t.delay_minutes || 0) <= 10 && (t.progress_pct || 0) > 0 && (t.progress_pct || 0) < 100 && t.status !== 'nodata'));
    } else if (state.liveTrackerFilter === 'delayed') {
      list = list.filter(t => t.status === 'delayed' || ((t.delay_minutes || 0) > 10 && (t.progress_pct || 0) < 100 && t.status !== 'nodata'));
    } else if (state.liveTrackerFilter === 'scheduled') {
      list = list.filter(t => t.status === 'scheduled' || ((t.progress_pct || 0) === 0 && t.status !== 'nodata' && t.status !== 'completed' && t.status !== 'arrived'));
    } else if (state.liveTrackerFilter === 'nodata') {
      list = list.filter(t => t.status === 'nodata' || (t.delay_text || '').toLowerCase().includes('no data') || (t.delay_text || '').toLowerCase().includes('no tracking') || t.status === 'offday');
    } else if (state.liveTrackerFilter === 'completed') {
      list = list.filter(t => t.status === 'completed' || t.status === 'arrived' || (t.progress_pct || 0) >= 100);
    }

    if (state.liveTrackerView === 'map') {
      initOrUpdateNetworkMap(list);
    }

    if (list.length === 0) {
      liveTrackerGrid.classList.add('hidden');
      if (liveTrackerEmptyState) liveTrackerEmptyState.classList.remove('hidden');
      return;
    }

    if (liveTrackerEmptyState) liveTrackerEmptyState.classList.add('hidden');
    if (state.liveTrackerView === 'grid') {
      liveTrackerGrid.classList.remove('hidden');
    }

    liveTrackerGrid.innerHTML = list.map(t => {
      const delayMin = t.delay_minutes || 0;
      const progress = Math.min(100, Math.max(0, t.progress_pct || 0));
      const status = t.status || (progress >= 100 ? 'completed' : (progress > 0 ? 'running' : 'scheduled'));

      let delayBadgeClass = '';
      let delayText = '';

      if (status === 'completed' || status === 'arrived' || progress >= 100) {
        delayBadgeClass = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700';
        delayText = '🏁 Completed';
      } else if (status === 'nodata') {
        delayBadgeClass = 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700';
        delayText = '⚪ No data';
      } else if (status === 'scheduled' || progress === 0) {
        delayBadgeClass = 'bg-blue-50 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800';
        delayText = '⏱️ Scheduled';
      } else if (delayMin <= 10) {
        delayBadgeClass = 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
        delayText = delayMin === 0 ? '🟢 On time' : `🟢 +${delayMin}m`;
      } else {
        delayBadgeClass = 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800';
        delayText = `🟡 +${delayMin}m`;
      }

      return `
        <div class="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl p-3.5 border border-slate-200/90 dark:border-slate-800 shadow-2xs hover:shadow-lg hover:border-cyan-500/50 dark:hover:border-cyan-500/50 transition-all flex flex-col justify-between space-y-3 group relative overflow-hidden">
          
          <!-- Card Header: Train ID Pill, Name, Route Duration & Status Badge -->
          <div class="flex items-start justify-between gap-2 pt-0.5">
            <div class="min-w-0">
              <div class="flex items-center space-x-1.5 flex-wrap">
                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 font-black border border-slate-200/80 dark:border-slate-700/80">#${t.train_no}</span>
                <h3 class="font-black text-xs sm:text-sm text-slate-900 dark:text-white truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">${escapeHtml(t.train_name)}</h3>
              </div>
              <p class="text-[10px] text-slate-400 font-semibold mt-0.5 flex items-center gap-1">
                <span>${t.duration || 'Intercity Express'}</span>
                <span>•</span>
                <span>${t.total_distance_km ? `${t.total_distance_km} km` : 'Active Run'}</span>
              </p>
            </div>
            <div class="flex flex-col items-end shrink-0">
              <span class="text-[10px] font-black px-2 py-0.5 rounded-full border ${delayBadgeClass}">
                ${delayText}
              </span>
              <span class="text-[9px] text-slate-400 mt-1 flex items-center gap-1 font-mono font-medium">
                <i class="fa-solid fa-satellite text-[8px] text-cyan-500"></i>
                <span>${t.last_updated ? (t.last_updated.toLowerCase().includes('ago') || t.last_updated.toLowerCase().includes('now') ? t.last_updated : `Sync ${t.last_updated}`) : 'Live GPS'}</span>
              </span>
            </div>
          </div>

          <!-- Corridor Progress HUD (Origin ➔ Progress ➔ Destination) -->
          <div class="p-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1.5">
            <div class="flex items-center justify-between text-xs font-bold">
              <div class="min-w-0 pr-1 text-left">
                <div class="font-mono text-xs font-black text-slate-900 dark:text-white">${t.departure_time || '--:--'}</div>
                <div class="text-[10px] text-slate-600 dark:text-slate-300 font-extrabold truncate max-w-[90px]">${escapeHtml(t.from || 'Origin')}</div>
              </div>

              <!-- Sleek Progress HUD Bar -->
              <div class="flex-1 mx-2 flex flex-col items-center shrink-0 min-w-[75px]">
                <div class="flex items-center space-x-1 text-[9px] font-mono font-black text-cyan-600 dark:text-cyan-400">
                  <span>${progress}%</span>
                  ${t.speed ? `<span class="text-slate-400">•</span><span>${t.speed} km/h</span>` : ''}
                </div>
                <div class="w-full h-1.5 bg-slate-200 dark:bg-slate-700/80 rounded-full overflow-hidden relative mt-0.5">
                  <div class="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
                </div>
              </div>

              <div class="min-w-0 pl-1 text-right">
                <div class="font-mono text-xs font-black text-slate-900 dark:text-white">${t.arrival_time || '--:--'}</div>
                <div class="text-[10px] text-slate-600 dark:text-slate-300 font-extrabold truncate max-w-[90px]">${escapeHtml(t.to || 'Destination')}</div>
              </div>
            </div>
          </div>

          <!-- Real-Time Telemetry Bar & Action Trigger -->
          <div class="pt-1 flex items-center justify-between gap-2 text-[11px]">
            <div class="min-w-0 flex items-center space-x-1 text-[10px] text-slate-500 dark:text-slate-400 font-semibold truncate">
              <i class="fa-solid fa-location-crosshairs text-cyan-500 text-[9px] shrink-0"></i>
              <span class="truncate">${t.next_station ? `Next: <strong class="text-slate-700 dark:text-slate-200">${escapeHtml(t.next_station)}</strong>` : 'Full Route Tracking'}</span>
            </div>
            <button type="button" class="view-live-train-btn px-2.5 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 hover:bg-cyan-600 text-cyan-700 dark:text-cyan-300 hover:text-white border border-cyan-200/80 dark:border-cyan-800 text-[11px] font-black transition flex items-center space-x-1 shrink-0 cursor-pointer shadow-2xs" data-train-no="${t.train_no}">
              <i class="fa-solid fa-location-dot text-[9px]"></i>
              <span>Live Location</span>
            </button>
          </div>

        </div>
      `;
    }).join('');
  }

  async function openLiveTrainModal(trainNo, forceRefresh = false) {
    if (!liveTrainModal) return;
    state.currentLiveModalTrainNo = trainNo;
    liveTrainModal.classList.remove('hidden');

    if (refreshLiveTrainModalIcon) refreshLiveTrainModalIcon.classList.add('fa-spin');

    if (!forceRefresh) {
      if (liveTrainModalTitle) liveTrainModalTitle.textContent = `Loading Train #${trainNo}...`;
      if (liveTrainModalNumber) liveTrainModalNumber.textContent = `#${trainNo}`;
      if (liveTrainModalSubtitle) liveTrainModalSubtitle.textContent = 'Fetching real-time GPS position & stoppages...';

      if (liveModalTimelineContainer) {
        liveModalTimelineContainer.innerHTML = `
          <div class="p-8 text-center space-y-2">
            <div class="w-8 h-8 rounded-full border-3 border-cyan-500/20 border-t-cyan-500 animate-spin mx-auto"></div>
            <p class="text-xs text-slate-400">Loading stoppage schedule & delay history...</p>
          </div>
        `;
      }
    }

    try {
      const res = await fetch(`/api/live-tracker/train/${encodeURIComponent(trainNo)}${forceRefresh ? '?refresh=1' : ''}`);
      const data = await res.json();

      if (!data.success) {
        if (liveModalTimelineContainer) {
          liveModalTimelineContainer.innerHTML = `<div class="p-4 text-center text-xs text-rose-500 font-bold">${data.error || 'Unable to load train tracker details.'}</div>`;
        }
        return;
      }

      // Populate Modal Headers & Badges
      const displayName = data.train_name_bn && data.train_name_bn !== data.train_name
        ? `${data.train_name} (${data.train_name_bn})`
        : data.train_name;
      if (liveTrainModalTitle) liveTrainModalTitle.textContent = displayName;
      if (liveTrainModalNumber) liveTrainModalNumber.textContent = `#${data.train_no}`;
      
      const delayMin = data.delay_minutes || 0;
      const isOntime = delayMin <= 10;
      if (liveModalDelayBadge) {
        liveModalDelayBadge.textContent = isOntime && delayMin === 0 ? '🟢 On Time' : `🟡 Delayed · +${delayMin}m`;
        liveModalDelayBadge.className = `text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${isOntime ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' : 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'}`;
      }

      if (liveModalDurationSpan) liveModalDurationSpan.textContent = data.duration || 'Intercity';
      if (liveModalRouteSpan) liveModalRouteSpan.textContent = `${data.from} → ${data.to}`;
      if (liveModalSpeedSpan) liveModalSpeedSpan.textContent = data.speed ? `${data.speed} km/h` : (data.status || 'Active');
      if (liveModalLastPingSpan) liveModalLastPingSpan.textContent = `Live GPS: Updated ${data.last_updated || '0s ago'}`;

      // Route Progress Hero Card
      const progress = Math.min(100, Math.max(0, data.progress_pct || 0));
      if (liveModalOriginName) liveModalOriginName.textContent = data.from || 'Origin';
      if (liveModalOriginTime) liveModalOriginTime.textContent = data.departure_time || '--:--';
      if (liveModalProgressPctText) liveModalProgressPctText.textContent = `${progress}% Complete`;
      if (liveModalDestName) liveModalDestName.textContent = data.to || 'Destination';
      if (liveModalDestTime) liveModalDestTime.textContent = data.arrival_time || '--:--';
      if (liveModalProgressBar) liveModalProgressBar.style.width = `${progress}%`;

      const coveredKm = data.covered_distance_km || 0;
      const stoppages = data.stoppages || [];
      const totalKm = stoppages.length > 0 ? (stoppages[stoppages.length - 1].distance_km || 0) : 0;
      if (liveModalCoveredKmText) liveModalCoveredKmText.textContent = `${coveredKm} km covered`;
      if (liveModalTotalKmText) liveModalTotalKmText.textContent = totalKm ? `${totalKm} km total` : '';

      // Real-Time Next Station & Nearest Landmark Callouts (Full Station Names & Passed Distance)
      if (liveModalNextStationTitle) {
        liveModalNextStationTitle.textContent = data.next_stop || 'Destination';
      }
      if (liveModalNextStationSubtitle) {
        if (data.status === 'scheduled') {
          liveModalNextStationSubtitle.textContent = `Scheduled departure • ${data.next_eta || 'Today'}`;
        } else if (data.status === 'arrived' || data.status === 'completed') {
          liveModalNextStationSubtitle.textContent = `Journey completed at destination`;
        } else if (data.status === 'offday') {
          liveModalNextStationSubtitle.textContent = `Train off-day today`;
        } else {
          const passedFromPrev = (data.covered_since_prev_stop_km !== null && data.covered_since_prev_stop_km !== undefined) ? `${data.covered_since_prev_stop_km} km from ${data.prev_stop || 'prev stop'}` : '';
          const kmAhead = data.km_to_next ? `${data.km_to_next} km ahead` : 'En Route';
          const etaText = data.next_eta ? `ETA ${data.next_eta}` : '';
          const parts = [passedFromPrev, kmAhead, etaText].filter(Boolean);
          liveModalNextStationSubtitle.textContent = parts.join(' • ') || 'En Route';
        }
      }

      if (liveModalNearestTitle) {
        liveModalNearestTitle.textContent = data.nearest_station || data.next_stop || 'Tracking Route';
      }
      if (liveModalNearestSubtitle) {
        if (data.status === 'scheduled') {
          liveModalNearestSubtitle.textContent = 'At Origin Station';
        } else if (data.status === 'arrived' || data.status === 'completed') {
          liveModalNearestSubtitle.textContent = 'At Destination Station';
        } else if (data.nearest_distance_km !== null && data.nearest_distance_km !== undefined) {
          liveModalNearestSubtitle.textContent = `${data.nearest_distance_km} km away`;
        } else {
          liveModalNearestSubtitle.textContent = 'Near Route';
        }
      }

      // Quick Stats Pills
      if (liveModalSpeedPill) liveModalSpeedPill.textContent = data.speed ? `${data.speed} km/h` : 'Running';
      if (liveModalCoachesPill) {
        const coaches = data.coaches || 16;
        liveModalCoachesPill.textContent = `${coaches} Coaches`;
      }
      if (liveModalOffDayPill) {
        const offDay = data.off_day || 'No Off Day';
        liveModalOffDayPill.textContent = (offDay === '-1' || offDay.toLowerCase() === 'none') ? 'No Off Day' : offDay;
      }

      // Render Vertical Stoppage Timeline & Road Map
      if (liveModalStopsHeader) {
        liveModalStopsHeader.textContent = `Route Timeline • ${stoppages.length} stops`;
      }

      if (liveModalTimelineContainer) {
        if (stoppages.length === 0) {
          liveModalTimelineContainer.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No stoppage timetable available for this train.</div>`;
        } else {
          // Identify in-transit index between stations
          let activePrevIdx = data.prev_stop_idx;
          if (activePrevIdx < 0) {
            // Find last passed index
            for (let i = stoppages.length - 1; i >= 0; i--) {
              if (stoppages[i].status === 'passed' || stoppages[i].status === 'departed') {
                activePrevIdx = i;
                break;
              }
            }
          }

          liveModalTimelineContainer.innerHTML = stoppages.map((stop, idx) => {
            const isPassed = stop.status === 'passed' || stop.status === 'departed' || (activePrevIdx >= 0 && idx <= activePrevIdx);
            const isNextStop = stop.station_name === data.next_stop || (activePrevIdx >= 0 && idx === activePrevIdx + 1);

            let nodeIcon = '';
            let textClass = '';
            let statusBadge = '';

            if (isPassed) {
              nodeIcon = `<div class="relative z-10 w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[9px] shadow-2xs shrink-0"><i class="fa-solid fa-check"></i></div>`;
              textClass = 'text-slate-500 dark:text-slate-400';
              statusBadge = `<span class="text-[9px] font-bold text-slate-400">Passed</span>`;
            } else if (isNextStop) {
              nodeIcon = `<div class="relative z-10 w-6 h-6 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center text-[9px] shadow-sm shadow-cyan-500/40 ring-2 ring-cyan-500/30 animate-pulse shrink-0"><i class="fa-solid fa-location-crosshairs"></i></div>`;
              textClass = 'text-cyan-600 dark:text-cyan-400 font-black';
              statusBadge = `<span class="text-[9px] font-black px-2 py-0.2 rounded-full bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">NEXT STOP</span>`;
            } else {
              nodeIcon = `<div class="relative z-10 w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 flex items-center justify-center text-[9px] font-mono font-bold shrink-0">${idx + 1}</div>`;
              textClass = 'text-slate-800 dark:text-slate-200 font-bold';
              statusBadge = `<span class="text-[9px] font-semibold text-slate-400">Upcoming</span>`;
            }

            const stationBn = stop.station_bn && stop.station_bn !== stop.station_name ? ` <span class="text-[10px] font-normal text-slate-400">(${escapeHtml(stop.station_bn)})</span>` : '';

            // Display Scheduled Time vs Actual / Stoppage ETA Beside It
            let timeBadge = '';
            if (isPassed) {
              timeBadge = `
                <div class="flex items-center space-x-1 font-mono text-[11px]">
                  <span class="text-slate-400 font-semibold" title="Scheduled Time">${stop.scheduled_time}</span>
                  <span class="text-slate-300 dark:text-slate-600">·</span>
                  <span class="font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/70 px-1.5 py-0.2 rounded border border-emerald-200 dark:border-emerald-800" title="Actual Departed Time">Act: ${stop.actual_time || stop.scheduled_time}</span>
                </div>
              `;
            } else if (isNextStop) {
              timeBadge = `
                <div class="flex items-center space-x-1 font-mono text-[11px]">
                  <span class="text-slate-400 font-semibold" title="Scheduled Time">${stop.scheduled_time}</span>
                  <span class="text-slate-300 dark:text-slate-600">·</span>
                  <span class="font-black text-cyan-600 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-300 dark:border-cyan-800 animate-pulse" title="Next Stop ETA">ETA: ${stop.eta_time || stop.actual_time || stop.scheduled_time}</span>
                </div>
              `;
            } else {
              const hasDelay = delayMin > 0;
              timeBadge = `
                <div class="flex items-center space-x-1 font-mono text-[11px]">
                  <span class="text-slate-400 font-semibold" title="Scheduled Time">${stop.scheduled_time}</span>
                  <span class="text-slate-300 dark:text-slate-600">·</span>
                  <span class="font-black ${hasDelay ? 'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-800' : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'} px-1.5 py-0.2 rounded border" title="Estimated Arrival Time">ETA: ${stop.eta_time || stop.actual_time || stop.scheduled_time}</span>
                </div>
              `;
            }

            // Dynamic In-Transit Between-Station Indicator Box (Mobile-Compact)
            let inTransitRoadmapBlock = '';
            if (activePrevIdx >= 0 && idx === activePrevIdx && idx < stoppages.length - 1) {
              const segmentPct = data.segment_progress_pct || 50;
              inTransitRoadmapBlock = `
                <div class="my-2 ml-2 sm:ml-3 pl-3.5 sm:pl-4.5 pr-2.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500/10 via-teal-500/10 to-indigo-500/10 border border-cyan-500/30 relative shadow-2xs">
                  <!-- Vertical road track continuous connector -->
                  <div class="absolute -left-[1px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500 via-cyan-500 to-slate-300 dark:to-slate-700"></div>
                  
                  <!-- Moving Train Icon Beacon at Exact Relative Position -->
                  <div class="absolute -left-[10px] top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center text-[9px] shadow-sm shadow-cyan-500/40 ring-2 ring-cyan-500/30 animate-pulse">
                    <i class="fa-solid fa-train"></i>
                  </div>

                  <div class="space-y-1 min-w-0">
                    <div class="flex items-center justify-between gap-1.5 flex-wrap">
                      <div class="flex items-center space-x-1">
                        <span class="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-cyan-600 text-white flex items-center gap-1 shadow-2xs">
                          <span class="w-1 h-1 rounded-full bg-white animate-ping"></span>
                          <span>IN-TRANSIT (${segmentPct}%)</span>
                        </span>
                        <span class="text-[9px] font-mono font-extrabold px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-cyan-800 dark:text-cyan-200 border border-slate-200 dark:border-slate-700">
                          <i class="fa-solid fa-gauge-high text-[8px] mr-0.5 text-cyan-600"></i>${data.speed ? data.speed + ' km/h' : 'Moving'}
                        </span>
                      </div>
                      <span class="text-[9px] font-mono text-slate-400 font-bold">Updated ${data.last_updated || '0s ago'}</span>
                    </div>

                    <p class="text-[10px] sm:text-[11px] font-black text-slate-900 dark:text-white flex items-center gap-1 flex-wrap">
                      <span>${data.covered_since_prev_stop_km ? `${data.covered_since_prev_stop_km} km passed from ${escapeHtml(stop.station_name)}` : 'In transit'}</span>
                      <span class="text-cyan-500 font-bold">➔</span>
                      <span>${data.km_to_next ? `${data.km_to_next} km to ${escapeHtml(data.next_stop)}` : ''}</span>
                    </p>

                    <!-- Segment Progress Bar -->
                    <div class="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div class="h-full bg-gradient-to-r from-cyan-500 via-teal-500 to-indigo-500 rounded-full" style="width: ${segmentPct}%"></div>
                    </div>
                  </div>
                </div>
              `;
            }

            return `
              <div class="flex items-start space-x-2.5 pb-2.5 sm:pb-3 last:pb-0.5 relative group">
                ${nodeIcon}
                <div class="flex-1 min-w-0 pt-0.5">
                  <div class="flex items-center justify-between gap-1.5 flex-wrap">
                    <div class="font-extrabold text-xs sm:text-sm ${textClass}">
                      ${escapeHtml(stop.station_name)}${stationBn}
                    </div>
                    <div class="flex items-center space-x-1.5 shrink-0">
                      ${timeBadge}
                      ${statusBadge}
                    </div>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                    <span>${stop.station_code ? stop.station_code + ' • ' : ''}${stop.distance_km} km</span>
                    <span class="font-mono text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">${stop.platform && stop.platform !== '—' ? stop.platform : 'PF --'}</span>
                  </div>
                </div>
              </div>
              ${inTransitRoadmapBlock}
            `;
          }).join('');
        }
      }

      // Render 7-Day Delay History Bar Chart
      if (liveModalDelayBars && liveModalAvgDelayBadge) {
        const history = data.delay_history || {};
        const runs = history.recent_runs || [];
        liveModalAvgDelayBadge.textContent = `Avg: ~${history.avg_delay_minutes || 0}m`;

        if (runs.length === 0) {
          liveModalDelayBars.innerHTML = `<div class="w-full text-center text-[11px] text-slate-400 py-3">No historical runs recorded for this train yet.</div>`;
        } else {
          const maxDelay = Math.max(...runs.map(r => r.delay_minutes || 0), 60);
          liveModalDelayBars.innerHTML = runs.slice(-14).map(run => {
            const delay = run.delay_minutes || 0;
            const barHeightPct = Math.max(15, Math.min(100, Math.round((delay / maxDelay) * 100)));
            const isLate = delay > 20;
            const barColor = isLate ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600';

            return `
              <div class="flex-1 flex flex-col items-center justify-end h-full group/bar relative cursor-pointer" title="${run.date}: +${delay}m delay">
                <span class="text-[9px] font-mono font-bold text-slate-500 mb-1">+${delay}m</span>
                <div class="w-full max-w-[28px] rounded-t-lg ${barColor} transition-all duration-300" style="height: ${barHeightPct}%"></div>
                <span class="text-[9px] text-slate-400 font-semibold mt-1 truncate">${run.date ? run.date.split('-').slice(1).join('/') : ''}</span>
              </div>
            `;
          }).join('');
        }
      }

      state.currentModalTrainData = data;
      initOrUpdateModalMap(data);
      if (state.liveModalView === 'map') {
        setTimeout(() => {
          if (liveModalLeafletMap) liveModalLeafletMap.invalidateSize();
        }, 50);
        setTimeout(() => {
          if (liveModalLeafletMap) liveModalLeafletMap.invalidateSize();
        }, 200);
      }

    } catch (e) {
      if (liveModalTimelineContainer) {
        liveModalTimelineContainer.innerHTML = `<div class="p-4 text-center text-xs text-rose-500 font-bold">Network error loading train tracker data.</div>`;
      }
    } finally {
      if (refreshLiveTrainModalIcon) refreshLiveTrainModalIcon.classList.remove('fa-spin');
    }
  }

  // ----------------------------------------------------
  // ⚡ Auto Book Seat & Release Scheduler Module
  // ----------------------------------------------------
  function initAutoBookModule() {
    const autoBookSection = document.getElementById('autoBookSection');
    if (!autoBookSection) return;

    const isBn = () => window.i18n && window.i18n.getLang() === 'bn';

    // Elements
    const autoBookCountdownTimer = document.getElementById('autoBookCountdownTimer');
    const autoBookTabNow = document.getElementById('autoBookTabNow');
    const autoBookTabSchedule = document.getElementById('autoBookTabSchedule');
    const autoBookFromInput = document.getElementById('autoBookFromInput');
    const autoBookFromClearBtn = document.getElementById('autoBookFromClearBtn');
    const autoBookFromDropdown = document.getElementById('autoBookFromDropdown');
    const autoBookToInput = document.getElementById('autoBookToInput');
    const autoBookToClearBtn = document.getElementById('autoBookToClearBtn');
    const autoBookToDropdown = document.getElementById('autoBookToDropdown');
    const autoBookSwapBtn = document.getElementById('autoBookSwapBtn');
    const autoBookDateInput = document.getElementById('autoBookDateInput');
    const autoBookQuickDateChips = document.getElementById('autoBookQuickDateChips');
    const autoBookTrainSelect = document.getElementById('autoBookTrainSelect'); // legacy fallback
    const autoBookClassSelect = document.getElementById('autoBookClassSelect'); // legacy fallback
    const autoBookTrainDropdownContainer = document.getElementById('autoBookTrainDropdownContainer');
    const autoBookTrainDropdownBtn = document.getElementById('autoBookTrainDropdownBtn');
    const autoBookTrainBtnText = document.getElementById('autoBookTrainBtnText');
    const autoBookTrainChevron = document.getElementById('autoBookTrainChevron');
    const autoBookTrainDropdownMenu = document.getElementById('autoBookTrainDropdownMenu');
    const autoBookTrainOptionsList = document.getElementById('autoBookTrainOptionsList');
    const autoBookTrainCountBadge = document.getElementById('autoBookTrainCountBadge');

    const autoBookClassDropdownContainer = document.getElementById('autoBookClassDropdownContainer');
    const autoBookClassDropdownBtn = document.getElementById('autoBookClassDropdownBtn');
    const autoBookClassBtnText = document.getElementById('autoBookClassBtnText');
    const autoBookClassChevron = document.getElementById('autoBookClassChevron');
    const autoBookClassDropdownMenu = document.getElementById('autoBookClassDropdownMenu');
    const autoBookClassOptionsList = document.getElementById('autoBookClassOptionsList');
    const autoBookClassCountBadge = document.getElementById('autoBookClassCountBadge');

    const autoBookSeatCountGroup = document.getElementById('autoBookSeatCountGroup');
    const autoBookPositionPref = document.getElementById('autoBookPositionPref');
    const autoBookKeepTogetherToggle = document.getElementById('autoBookKeepTogetherToggle');
    const autoBookKeepTryingToggle = document.getElementById('autoBookKeepTryingToggle');
    const autoBookModeHold = document.getElementById('autoBookModeHold');
    const autoBookModeBuy = document.getElementById('autoBookModeBuy');
    // Helper: returns true if "Hold Only" mode is selected
    function isHoldOnlyMode() { return autoBookModeHold && autoBookModeHold.checked; }
    // Helper: returns true if "Buy Now" (auto-proceed to OTP) mode is selected
    function isBuyNowMode() { return !isHoldOnlyMode(); }

    const autoBookModeBanner = document.getElementById('autoBookModeBanner');
    const autoBookModeBadgeIcon = document.getElementById('autoBookModeBadgeIcon');
    const autoBookModeIconEl = document.getElementById('autoBookModeIconEl');
    const autoBookModeTitle = document.getElementById('autoBookModeTitle');
    const autoBookModeTag = document.getElementById('autoBookModeTag');
    const autoBookModeSubtext = document.getElementById('autoBookModeSubtext');
    const autoBookDateBadge = document.getElementById('autoBookDateBadge');

    const autoBookSoundAlarmToggle = document.getElementById('autoBookSoundAlarmToggle');
    const autoBookActionBtn = document.getElementById('autoBookActionBtn');
    const autoBookActionIcon = document.getElementById('autoBookActionIcon');
    const autoBookActionText = document.getElementById('autoBookActionText');
    const headlessGrabNowBtn = document.getElementById('headlessGrabNowBtn');
    const headlessGrabNowIcon = document.getElementById('headlessGrabNowIcon');
    const headlessGrabNowText = document.getElementById('headlessGrabNowText');
    const autoBookConsoleBox = document.getElementById('autoBookConsoleBox');
    const autoBookConsoleStatus = document.getElementById('autoBookConsoleStatus');
    const autoBookConsoleLogs = document.getElementById('autoBookConsoleLogs');
    const autoBookTasksBadge = document.getElementById('autoBookTasksBadge');
    const autoBookTasksList = document.getElementById('autoBookTasksList');
    const autoBookTasksEmpty = document.getElementById('autoBookTasksEmpty');
    const autoBookClearAllTasksBtn = document.getElementById('autoBookClearAllTasksBtn');

    let currentMode = 'now'; // 'now' or 'schedule'
    let selectedSeatsCount = 1;
    let autoBookTasks = [];
    let isAutoGrabRetrying = false;
    let autoGrabRetryTimeout = null;
    let autoGrabAttemptCount = 0;

    try {
      const stored = localStorage.getItem('railseat_autobook_tasks');
      if (stored) autoBookTasks = JSON.parse(stored);
      if (!Array.isArray(autoBookTasks)) autoBookTasks = [];
    } catch (e) {
      autoBookTasks = [];
    }

    // 1. Live 8:00 AM Ticket Drop Countdown
    function updateCountdown() {
      if (!autoBookCountdownTimer) return;
      const now = new Date();
      // Bangladesh is UTC+6
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const bdNow = new Date(utc + (3600000 * 6));

      const bdTarget = new Date(bdNow);
      bdTarget.setHours(8, 0, 0, 0);

      if (bdNow.getTime() >= bdTarget.getTime()) {
        bdTarget.setDate(bdTarget.getDate() + 1);
      }

      const diffMs = bdTarget.getTime() - bdNow.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(diffSecs / 3600);
      const minutes = Math.floor((diffSecs % 3600) / 60);
      const seconds = diffSecs % 60;

      const pad = (n) => String(n).padStart(2, '0');
      const timeStr = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

      autoBookCountdownTimer.textContent = isBn() && window.i18n ? window.i18n.toBnNum(timeStr) : timeStr;

      if (diffSecs <= 30) {
        autoBookCountdownTimer.classList.add('animate-pulse', 'text-rose-600');
        autoBookCountdownTimer.classList.remove('text-amber-600');
      } else {
        autoBookCountdownTimer.classList.remove('animate-pulse', 'text-rose-600');
        autoBookCountdownTimer.classList.add('text-amber-600');
      }
    }
    setInterval(updateCountdown, 1000);
    updateCountdown();

    // 2. Audio Chime Generator using Web Audio API (Multiple Ringtones: chime, whistle, siren, bell)
    let autoBookAlarmLoopInterval = null;
    function playAlarmTone(style = 'chime') {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const now = audioCtx.currentTime;

        if (style === 'whistle') {
          // Double Train Whistle
          [0, 0.35].forEach(delay => {
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc1.type = 'sawtooth';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(440, now + delay);
            osc2.frequency.setValueAtTime(554.37, now + delay);
            gain.gain.setValueAtTime(0.2, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);
            osc1.start(now + delay);
            osc2.start(now + delay);
            osc1.stop(now + delay + 0.32);
            osc2.stop(now + delay + 0.32);
          });
        } else if (style === 'siren') {
          // Alert Siren Sweep
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(600, now);
          osc.frequency.linearRampToValueAtTime(1100, now + 0.3);
          osc.frequency.linearRampToValueAtTime(600, now + 0.6);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.65);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.66);
        } else if (style === 'bell') {
          // Station Bell
          [784, 1046.5].forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.2);
            gain.gain.setValueAtTime(0.35, now + idx * 0.2);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.2 + 0.8);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + idx * 0.2);
            osc.stop(now + idx * 0.2 + 0.85);
          });
        } else {
          // Default Chime arpeggio
          const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
          notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.12);
            gain.gain.setValueAtTime(0.3, now + idx * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + idx * 0.12);
            osc.stop(now + idx * 0.12 + 0.36);
          });
        }
      } catch (e) {
        console.warn('[AutoBook] Audio tone error:', e);
      }
    }

    function playAlarmChime() {
      const ringtoneSelect = document.getElementById('autoBookRingtoneSelect');
      const selectedStyle = ringtoneSelect ? ringtoneSelect.value : 'chime';
      // Play 3 times to ensure user hears it
      playAlarmTone(selectedStyle);
      setTimeout(() => playAlarmTone(selectedStyle), 600);
      setTimeout(() => playAlarmTone(selectedStyle), 1200);
    }

    const autoBookTestToneBtn = document.getElementById('autoBookTestToneBtn');
    if (autoBookTestToneBtn) {
      autoBookTestToneBtn.addEventListener('click', () => {
        const ringtoneSelect = document.getElementById('autoBookRingtoneSelect');
        const selectedStyle = ringtoneSelect ? ringtoneSelect.value : 'chime';
        playAlarmTone(selectedStyle);
      });
    }

    // 3. Station Autocompletes
    if (autoBookFromInput && autoBookFromDropdown && autoBookFromClearBtn) {
      setupAutocomplete(autoBookFromInput, autoBookFromDropdown, autoBookFromClearBtn, () => {
        populateAutoBookRouteData();
      });
      autoBookFromInput.addEventListener('change', () => populateAutoBookRouteData());
      autoBookFromInput.addEventListener('blur', () => populateAutoBookRouteData());
      if (!autoBookFromInput.value && state.selectedFrom) {
        autoBookFromInput.value = state.selectedFrom;
      }
    }

    if (autoBookToInput && autoBookToDropdown && autoBookToClearBtn) {
      setupAutocomplete(autoBookToInput, autoBookToDropdown, autoBookToClearBtn, () => {
        populateAutoBookRouteData();
      });
      autoBookToInput.addEventListener('change', () => populateAutoBookRouteData());
      autoBookToInput.addEventListener('blur', () => populateAutoBookRouteData());
      if (!autoBookToInput.value && state.selectedTo) {
        autoBookToInput.value = state.selectedTo;
      }
    }

    if (autoBookSwapBtn) {
      autoBookSwapBtn.addEventListener('click', () => {
        const temp = autoBookFromInput.value;
        autoBookFromInput.value = autoBookToInput.value;
        autoBookToInput.value = temp;
        if (autoBookFromClearBtn) autoBookFromClearBtn.classList.toggle('hidden', !autoBookFromInput.value);
        if (autoBookToClearBtn) autoBookToClearBtn.classList.toggle('hidden', !autoBookToInput.value);
        populateAutoBookRouteData();
      });
    }

    // 4. Date Setup, Smart Mode Auto-Detection & Quick Chips
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxFutureDate = new Date(today);
    maxFutureDate.setDate(today.getDate() + 30); // Allow selecting up to 30 days ahead for auto-scheduling
    const toYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Calculate difference in days between selected journey date and today (0 = today, 10 = max currently open)
    function getDaysFromToday(dateStr) {
      if (!dateStr) return 0;
      const [y, m, d] = dateStr.split('-').map(Number);
      const chosen = new Date(y, m - 1, d, 0, 0, 0);
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      return Math.round((chosen.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Auto-detect whether date is within live booking window (0-10 days) or future 8:00 AM schedule (11+ days)
    function autoDetectModeFromDate(dateStr) {
      const days = getDaysFromToday(dateStr);
      // In Bangladesh Railway, today through next 10 days (11 dates total) are currently available on railway servers
      if (days <= 10) {
        setAutoBookMode('now');
      } else {
        setAutoBookMode('schedule');
      }
    }

    if (autoBookDateInput) {
      autoBookDateInput.min = toYMD(today);
      autoBookDateInput.max = toYMD(maxFutureDate);
      autoBookDateInput.value = state.selectedDate || toYMD(today);
      autoBookDateInput.addEventListener('change', () => {
        autoDetectModeFromDate(autoBookDateInput.value);
        populateAutoBookRouteData();
      });
    }

    if (autoBookQuickDateChips) {
      const chipDefs = [
        { label: 'Today (আজ)', days: 0 },
        { label: 'Tomorrow (কাল)', days: 1 },
        { label: '+2 Days', days: 2 },
        { label: '+7 Days', days: 7 },
        { label: '+10 Days (Live)', days: 10 },
        { label: '⏰ +11 Days (Auto-Schedule)', days: 11 },
        { label: '⏰ +14 Days', days: 14 }
      ];

      autoBookQuickDateChips.innerHTML = chipDefs.map(c => {
        const d = new Date();
        d.setDate(today.getDate() + c.days);
        const ymd = toYMD(d);
        const isFuture = c.days > 10;
        const badgeClasses = isFuture
          ? 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700/60'
          : 'bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-slate-700 dark:text-slate-300 hover:text-amber-700 dark:hover:text-amber-300 border-slate-200 dark:border-slate-700';
        return `
          <button type="button" data-date="${ymd}" class="autobook-quick-date-chip px-2 py-0.5 rounded-md text-[10px] font-bold ${badgeClasses} transition cursor-pointer border">
            ${c.label}
          </button>
        `;
      }).join('');

      autoBookQuickDateChips.querySelectorAll('.autobook-quick-date-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          if (autoBookDateInput) {
            autoBookDateInput.value = btn.dataset.date;
            autoDetectModeFromDate(autoBookDateInput.value);
            populateAutoBookRouteData();
          }
        });
      });
    }

    // 5. Dynamic Route-Aware Multi-Select Train & Full-Class Selectors
    let currentAutoBookRouteTrains = [];
    let currentAutoBookRouteClasses = [];
    let autoBookRouteAbortCtrl = null;

    // All official Bangladesh Railway classes list (matching Seat Finder class filter order & options)
    const ALL_BR_CLASSES = [
      'SNIGDHA',
      'S_CHAIR',
      'AC_S',
      'AC_B',
      'SHOVAN',
      'SULOB',
      'F_SEAT',
      'F_BERTH',
      'AC_CHAIR'
    ];

    // Selected classes state (Array of string class names, e.g. ['SNIGDHA', 'S_CHAIR']. Empty or ['ANY'] means Any Class)
    let selectedAutoBookClasses = ['ANY'];
    // Selected trains state (Array of string train names, e.g. ['Subarna Express']. Empty or ['ALL'] means Any Train)
    let selectedAutoBookTrains = ['ALL'];

    // Helper: update Class UI button label & badge
    function updateClassDropdownUI() {
      if (!autoBookClassBtnText) return;
      const isBnLang = isBn();
      if (selectedAutoBookClasses.includes('ANY') || selectedAutoBookClasses.length === 0) {
        autoBookClassBtnText.textContent = isBnLang ? 'যেকোনো ক্লাস (Any Available)' : 'Any Available Class (যেকোনো ক্লাস)';
        if (autoBookClassCountBadge) autoBookClassCountBadge.textContent = isBnLang ? 'সব ক্লাস' : 'Any Class';
        if (autoBookClassSelect) autoBookClassSelect.value = 'ANY';
      } else {
        const labels = selectedAutoBookClasses.map(c => window.i18n ? window.i18n.getSeatClassName(c) : c);
        autoBookClassBtnText.textContent = labels.join(', ');
        if (autoBookClassCountBadge) {
          const count = selectedAutoBookClasses.length;
          autoBookClassCountBadge.textContent = isBnLang ? `${count}টি ক্লাস` : (count === 1 ? '1 Class' : `${count} Classes`);
        }
        if (autoBookClassSelect) autoBookClassSelect.value = selectedAutoBookClasses[0];
      }
    }

    // Helper: update Train UI button label & badge
    function updateTrainDropdownUI() {
      if (!autoBookTrainBtnText) return;
      const isBnLang = isBn();
      if (selectedAutoBookTrains.includes('ALL') || selectedAutoBookTrains.length === 0) {
        autoBookTrainBtnText.textContent = isBnLang ? 'যেকোনো ট্রেন (Any Train on Route)' : 'Any Train on Route (যেকোনো ট্রেন)';
        if (autoBookTrainCountBadge) autoBookTrainCountBadge.textContent = isBnLang ? 'সব ট্রেন' : 'Any Train';
        if (autoBookTrainSelect) autoBookTrainSelect.value = 'ALL';
      } else {
        autoBookTrainBtnText.textContent = selectedAutoBookTrains.join(', ');
        if (autoBookTrainCountBadge) {
          const count = selectedAutoBookTrains.length;
          autoBookTrainCountBadge.textContent = isBnLang ? `${count}টি ট্রেন` : (count === 1 ? '1 Train' : `${count} Trains`);
        }
        if (autoBookTrainSelect) autoBookTrainSelect.value = selectedAutoBookTrains[0];
      }
    }

    // Get available classes: sort by Seat Finder class order so user always sees the exact same class dropdown list
    function getAvailableAutoBookClasses() {
      if (Array.isArray(currentAutoBookRouteTrains) && currentAutoBookRouteTrains.length > 0) {
        const isAllTrains = selectedAutoBookTrains.includes('ALL') || selectedAutoBookTrains.length === 0;
        const targetTrainsList = isAllTrains
          ? currentAutoBookRouteTrains
          : currentAutoBookRouteTrains.filter(t => selectedAutoBookTrains.includes(t.train_name || t.name));
        
        const set = new Set();
        targetTrainsList.forEach(t => {
          if (Array.isArray(t.classes)) {
            t.classes.forEach(c => { if (c) set.add(String(c).toUpperCase()); });
          }
        });
        if (set.size > 0) {
          return ALL_BR_CLASSES.filter(c => set.has(c)).concat(Array.from(set).filter(c => !ALL_BR_CLASSES.includes(c)));
        }
      }
      if (Array.isArray(currentAutoBookRouteClasses) && currentAutoBookRouteClasses.length > 0) {
        const routeClassSet = new Set(currentAutoBookRouteClasses.map(c => String(c).toUpperCase()));
        return ALL_BR_CLASSES.filter(c => routeClassSet.has(c)).concat(Array.from(routeClassSet).filter(c => !ALL_BR_CLASSES.includes(c)));
      }
      return ALL_BR_CLASSES;
    }

    // Render Bangladesh Railway Classes (dynamically synced from Shohoz server for selected route & train)
    function renderAutoBookClasses() {
      if (!autoBookClassOptionsList) return;
      const isBnLang = isBn();
      const availableClasses = getAvailableAutoBookClasses();

      // Clean up selectedAutoBookClasses if any selected class is no longer available on this route/train
      if (!selectedAutoBookClasses.includes('ANY')) {
        const validSelected = selectedAutoBookClasses.filter(c => availableClasses.includes(c));
        if (validSelected.length !== selectedAutoBookClasses.length) {
          selectedAutoBookClasses = validSelected.length > 0 ? validSelected : ['ANY'];
        }
      }

      let html = '';
      // "Any Class" Option
      const isAnyChecked = selectedAutoBookClasses.includes('ANY') || selectedAutoBookClasses.length === 0;
      html += `
        <label class="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer select-none">
          <div class="flex items-center gap-2">
            <input type="checkbox" value="ANY" class="autobook-class-checkbox rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500" ${isAnyChecked ? 'checked' : ''} />
            <span class="text-xs font-black text-slate-800 dark:text-slate-200">${isBnLang ? 'যেকোনো ক্লাস (Any Available Class)' : 'Any Available Class (যেকোনো)'}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-semibold">${isBnLang ? 'সব গ্রহণ করুন' : 'Accept Any'}</span>
        </label>
        <div class="h-px bg-slate-100 dark:bg-slate-800 my-1"></div>
      `;

      availableClasses.forEach(cls => {
        const isChecked = !isAnyChecked && selectedAutoBookClasses.includes(cls);
        const displayName = window.i18n ? window.i18n.getSeatClassName(cls) : cls;
        html += `
          <label class="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer select-none">
            <div class="flex items-center gap-2 min-w-0">
              <input type="checkbox" value="${cls}" class="autobook-class-checkbox rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500" ${isChecked ? 'checked' : ''} />
              <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">${displayName}</span>
            </div>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-500 dark:text-slate-400 shrink-0 ml-2">${cls}</span>
          </label>
        `;
      });

      autoBookClassOptionsList.innerHTML = html;

      // Event listener for class checkboxes
      autoBookClassOptionsList.querySelectorAll('.autobook-class-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const val = cb.value;
          if (val === 'ANY') {
            if (cb.checked) {
              selectedAutoBookClasses = ['ANY'];
            } else {
              selectedAutoBookClasses = [];
            }
          } else {
            // Uncheck 'ANY' if specific class chosen
            selectedAutoBookClasses = selectedAutoBookClasses.filter(c => c !== 'ANY');
            if (cb.checked) {
              if (!selectedAutoBookClasses.includes(val)) selectedAutoBookClasses.push(val);
            } else {
              selectedAutoBookClasses = selectedAutoBookClasses.filter(c => c !== val);
            }
            if (selectedAutoBookClasses.length === 0) {
              selectedAutoBookClasses = ['ANY'];
            }
          }
          renderAutoBookClasses();
          updateClassDropdownUI();
        });
      });

      updateClassDropdownUI();
    }

    // Render Trains List with Multi-Select support
    function renderAutoBookTrains(trains) {
      if (!autoBookTrainOptionsList) return;
      const isBnLang = isBn();

      let html = '';
      // "Any Train" Option
      const isAllChecked = selectedAutoBookTrains.includes('ALL') || selectedAutoBookTrains.length === 0;
      html += `
        <label class="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer select-none">
          <div class="flex items-center gap-2">
            <input type="checkbox" value="ALL" class="autobook-train-checkbox rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500" ${isAllChecked ? 'checked' : ''} />
            <span class="text-xs font-black text-slate-800 dark:text-slate-200">${isBnLang ? 'যেকোনো ট্রেন (Any Train on Route)' : 'Any Train on Route (যেকোনো ট্রেন)'}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-semibold">${isBnLang ? 'সব ট্রেন' : 'All'}</span>
        </label>
        <div class="h-px bg-slate-100 dark:bg-slate-800 my-1"></div>
      `;

      if (Array.isArray(trains) && trains.length > 0) {
        trains.forEach(t => {
          const name = t.train_name || t.name;
          const model = t.train_model || t.model || '';
          const depRaw = String(t.departure_time || '').trim();
          const depTime = (depRaw.includes(',') ? depRaw.split(',').pop() : depRaw).trim();
          const showTime = !!depTime && !/^(n\/a|na|-+|TBD)$/i.test(depTime);
          const depLabel = showTime ? (isBnLang && window.i18n ? window.i18n.toBnNum(depTime) : depTime) : '';
          if (name) {
            const isChecked = !isAllChecked && selectedAutoBookTrains.includes(name);
            html += `
              <label class="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer select-none" title="${escapeHtml(name)}${depRaw ? ` — Dep: ${escapeHtml(depRaw)}` : ''}">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <input type="checkbox" value="${name}" data-model="${model}" class="autobook-train-checkbox rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500 shrink-0" ${isChecked ? 'checked' : ''} />
                  <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">${name}</span>
                </div>
                <span class="flex items-center gap-1.5 shrink-0">
                  ${showTime ? `<span class="text-[10px] leading-none font-mono font-black px-1.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900 whitespace-nowrap">${depLabel}</span>` : ''}
                  ${model ? `<span class="text-[10px] leading-none px-1.5 py-1 rounded bg-slate-100 dark:bg-slate-800 font-mono font-bold text-cyan-600 dark:text-cyan-400 whitespace-nowrap">#${model}</span>` : ''}
                </span>
              </label>
            `;
          }
        });
      } else {
        html += `
          <div class="p-3 text-center text-xs text-slate-400">
            ${isBnLang ? 'স্টেশন নির্বাচন করুন ট্রেন দেখার জন্য' : 'Select stations to see route trains'}
          </div>
        `;
      }

      autoBookTrainOptionsList.innerHTML = html;

      // Event listener for train checkboxes
      autoBookTrainOptionsList.querySelectorAll('.autobook-train-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const val = cb.value;
          if (val === 'ALL') {
            if (cb.checked) {
              selectedAutoBookTrains = ['ALL'];
            } else {
              selectedAutoBookTrains = [];
            }
          } else {
            selectedAutoBookTrains = selectedAutoBookTrains.filter(t => t !== 'ALL');
            if (cb.checked) {
              if (!selectedAutoBookTrains.includes(val)) selectedAutoBookTrains.push(val);
            } else {
              selectedAutoBookTrains = selectedAutoBookTrains.filter(t => t !== val);
            }
            if (selectedAutoBookTrains.length === 0) {
              selectedAutoBookTrains = ['ALL'];
            }
          }
          renderAutoBookTrains(currentAutoBookRouteTrains);
          updateTrainDropdownUI();
          // Dynamically re-sync seat classes to match selected train(s) on Shohoz
          renderAutoBookClasses();
        });
      });

      updateTrainDropdownUI();
    }

    // Toggle dropdown open/close handlers
    if (autoBookClassDropdownBtn && autoBookClassDropdownMenu) {
      autoBookClassDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = autoBookClassDropdownMenu.classList.contains('hidden');
        if (autoBookTrainDropdownMenu) autoBookTrainDropdownMenu.classList.add('hidden');
        if (isHidden) {
          autoBookClassDropdownMenu.classList.remove('hidden');
          if (autoBookClassChevron) autoBookClassChevron.classList.add('rotate-180');
        } else {
          autoBookClassDropdownMenu.classList.add('hidden');
          if (autoBookClassChevron) autoBookClassChevron.classList.remove('rotate-180');
        }
      });
    }

    if (autoBookTrainDropdownBtn && autoBookTrainDropdownMenu) {
      autoBookTrainDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = autoBookTrainDropdownMenu.classList.contains('hidden');
        if (autoBookClassDropdownMenu) autoBookClassDropdownMenu.classList.add('hidden');
        if (isHidden) {
          autoBookTrainDropdownMenu.classList.remove('hidden');
          if (autoBookTrainChevron) autoBookTrainChevron.classList.add('rotate-180');
        } else {
          autoBookTrainDropdownMenu.classList.add('hidden');
          if (autoBookTrainChevron) autoBookTrainChevron.classList.remove('rotate-180');
        }
      });
    }

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (autoBookClassDropdownContainer && !autoBookClassDropdownContainer.contains(e.target)) {
        if (autoBookClassDropdownMenu) autoBookClassDropdownMenu.classList.add('hidden');
        if (autoBookClassChevron) autoBookClassChevron.classList.remove('rotate-180');
      }
      if (autoBookTrainDropdownContainer && !autoBookTrainDropdownContainer.contains(e.target)) {
        if (autoBookTrainDropdownMenu) autoBookTrainDropdownMenu.classList.add('hidden');
        if (autoBookTrainChevron) autoBookTrainChevron.classList.remove('rotate-180');
      }
    });

    // Populate route trains and dynamic classes from Shohoz server
    async function populateAutoBookRouteData() {
      const fromCity = (autoBookFromInput?.value || '').trim();
      const toCity = (autoBookToInput?.value || '').trim();
      const journeyDate = autoBookDateInput?.value || '';

      if (!fromCity || !toCity) {
        currentAutoBookRouteTrains = state.trainsCatalog || [];
        currentAutoBookRouteClasses = [];
        renderAutoBookTrains(currentAutoBookRouteTrains);
        renderAutoBookClasses();
        return;
      }

      // Step 1: Immediate local filter
      const fromLower = fromCity.toLowerCase();
      const toLower = toCity.toLowerCase();
      const localMatches = (state.trainsCatalog || []).filter(t => {
        const f = String(t.from || '').toLowerCase();
        const to = String(t.to || '').toLowerCase();
        return (f.includes(fromLower) || fromLower.includes(f)) && (to.includes(toLower) || toLower.includes(to));
      });

      if (localMatches.length > 0) {
        currentAutoBookRouteTrains = localMatches;
        // Collect any classes defined locally in catalog
        const localClassSet = new Set();
        localMatches.forEach(t => {
          if (Array.isArray(t.classes)) {
            t.classes.forEach(c => { if (c) localClassSet.add(String(c).toUpperCase()); });
          }
        });
        if (localClassSet.size > 0) {
          currentAutoBookRouteClasses = Array.from(localClassSet);
        }
        renderAutoBookTrains(localMatches);
        renderAutoBookClasses();
      }

      // Step 2: Fetch 100% exact live route trains & classes from Shohoz via backend
      if (autoBookRouteAbortCtrl) {
        autoBookRouteAbortCtrl.abort();
      }
      autoBookRouteAbortCtrl = new AbortController();

      try {
        const params = new URLSearchParams({
          from_city: fromCity,
          to_city: toCity,
          date_of_journey: journeyDate
        });
        const res = await fetch(`/api/route-trains-classes?${params.toString()}`, {
          signal: autoBookRouteAbortCtrl.signal
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.trains) && json.trains.length > 0) {
            currentAutoBookRouteTrains = json.trains;
            if (Array.isArray(json.classes) && json.classes.length > 0) {
              currentAutoBookRouteClasses = json.classes;
            } else {
              const liveSet = new Set();
              json.trains.forEach(t => {
                if (Array.isArray(t.classes)) {
                  t.classes.forEach(c => { if (c) liveSet.add(String(c).toUpperCase()); });
                }
              });
              currentAutoBookRouteClasses = Array.from(liveSet);
            }
            renderAutoBookTrains(currentAutoBookRouteTrains);
            renderAutoBookClasses();
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[AutoBook] Failed to fetch route trains:', err.message);
        }
      }
    }

    populateAutoBookRouteData();
    window.addEventListener('trainsCatalogLoaded', () => populateAutoBookRouteData());

    // 6. Dynamic Seat Quantity Selector (1 to 4) & Keep Group Together Toggle
    function updateAutoBookSeatCountUI(seats, autoCheckTogether = true) {
      selectedSeatsCount = Math.min(4, Math.max(1, Number(seats) || 1));
      if (autoBookSeatCountGroup) {
        autoBookSeatCountGroup.querySelectorAll('.autobook-seat-count-btn').forEach(b => {
          const isSelected = Number(b.dataset.seats) === selectedSeatsCount;
          b.className = isSelected
            ? 'autobook-seat-count-btn py-2 text-xs font-black rounded-lg transition bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs cursor-pointer'
            : 'autobook-seat-count-btn py-2 text-xs font-bold rounded-lg transition text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 cursor-pointer';
        });
      }
      const keepTogetherContainer = document.getElementById('autoBookKeepTogetherContainer');
      if (selectedSeatsCount >= 2) {
        if (keepTogetherContainer) keepTogetherContainer.classList.remove('hidden');
        if (autoCheckTogether && autoBookKeepTogetherToggle) autoBookKeepTogetherToggle.checked = true;
      } else {
        if (keepTogetherContainer) keepTogetherContainer.classList.add('hidden');
        if (autoCheckTogether && autoBookKeepTogetherToggle) autoBookKeepTogetherToggle.checked = false;
      }
    }

    if (autoBookSeatCountGroup) {
      autoBookSeatCountGroup.querySelectorAll('.autobook-seat-count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          updateAutoBookSeatCountUI(btn.dataset.seats, true);
        });
      });
      // Initial state sync (default 1 seat keeps group together toggle hidden)
      updateAutoBookSeatCountUI(selectedSeatsCount, false);
    }

    // 7. Unified Smart Auto-Book Mode & Action State
    function updateAutoBookActionState() {
      const isHold = isHoldOnlyMode();
      const journeyDate = autoBookDateInput?.value || '';
      const days = getDaysFromToday(journeyDate);

      // 1. Update Mode Tag, Subtext & Date Badge
      if (currentMode === 'now') {
        if (autoBookModeTag) {
          autoBookModeTag.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white';
          autoBookModeTag.textContent = isBn() ? 'লাইভ সিট' : 'Live Grab';
        }
        if (autoBookModeSubtext) {
          autoBookModeSubtext.textContent = isBn()
            ? 'এই তারিখের টিকিট উন্মুক্ত রয়েছে—বাটনে চাপলে তাৎক্ষণিক সিট বুকিং শুরু হবে।'
            : 'Tickets are currently open on Railway—clicking below will instantly search and grab seats.';
        }
        if (autoBookDateBadge) {
          autoBookDateBadge.className = 'text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400';
          autoBookDateBadge.textContent = isBn() ? '⚡ এখনই খুঁজুন' : '⚡ Find Now';
        }
      } else {
        if (autoBookModeTag) {
          autoBookModeTag.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white';
          autoBookModeTag.textContent = isBn() ? `শিডিউল (+${days} দিন)` : `Schedule (+${days}d)`;
        }
        if (autoBookModeSubtext) {
          autoBookModeSubtext.textContent = isBn()
            ? 'ভবিষ্যতের তারিখ—শিডিউল সেভ করে রাখুন, রিলিজের দিন সকাল ৮:০০ টায় স্বয়ংক্রিয়ভাবে সিট বুক হবে।'
            : 'Future date—saves your task and auto-grabs seats at 08:00 AM on ticket drop day.';
        }
        if (autoBookDateBadge) {
          autoBookDateBadge.className = 'text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400';
          autoBookDateBadge.textContent = isBn() ? '⏰ অটো শিডিউল' : '⏰ Auto-Schedule';
        }
      }

      // 2. Retrying State
      if (isAutoGrabRetrying) {
        if (autoBookActionBtn) {
          autoBookActionBtn.disabled = false;
          autoBookActionBtn.className = 'w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 hover:from-rose-700 hover:to-red-800 text-white font-extrabold text-sm shadow-md shadow-rose-500/25 hover:scale-[1.02] active:scale-95 transition flex items-center justify-center space-x-2 cursor-pointer';
        }
        if (autoBookActionIcon) autoBookActionIcon.className = 'fa-solid fa-hand text-amber-300 animate-pulse';
        if (autoBookActionText) autoBookActionText.textContent = isBn() ? '🛑 চেষ্টা থামান (Stop Trying)' : '🛑 Stop Trying';
        return;
      }

      // 3. Action Button Styling & Text
      if (currentMode === 'now') {
        if (autoBookActionBtn) {
          if (isHold) {
            autoBookActionBtn.className = 'w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold text-sm shadow-md shadow-blue-500/20 hover:scale-[1.02] active:scale-95 transition flex items-center justify-center space-x-2 cursor-pointer';
          } else {
            autoBookActionBtn.className = 'w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-600 to-amber-600 hover:from-amber-600 hover:to-orange-700 text-white font-extrabold text-sm shadow-md shadow-orange-500/20 hover:scale-[1.02] active:scale-95 transition flex items-center justify-center space-x-2 cursor-pointer';
          }
        }
        if (autoBookActionIcon) autoBookActionIcon.className = isHold ? 'fa-solid fa-hand' : 'fa-solid fa-bolt';
        if (autoBookActionText) autoBookActionText.textContent = isHold
          ? (isBn() ? '🖐️ সিট ধরে রাখুন (Hold Seat Only)' : '🖐️ Check & Hold Seat Only')
          : (isBn() ? '⚡ এখনই চেক ও অটো-বুক করুন' : '⚡ Check & Auto-Book Now');
      } else {
        if (autoBookActionBtn) {
          autoBookActionBtn.className = 'w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-sm shadow-md shadow-emerald-500/20 hover:scale-[1.02] active:scale-95 transition flex items-center justify-center space-x-2 cursor-pointer';
        }
        if (autoBookActionIcon) autoBookActionIcon.className = 'fa-solid fa-calendar-check';
        if (autoBookActionText) autoBookActionText.textContent = isHold
          ? (isBn() ? '⏰ শিডিউল সেভ করুন (Hold Seat)' : '⏰ Save & Schedule Seat Hold')
          : (isBn() ? '⏰ শিডিউল সেভ করুন (সকাল ৮:০০)' : '⏰ Save & Schedule Auto-Booking');
      }
    }

    function stopAutoGrabRetrying(userInitiated = true) {
      if (!isAutoGrabRetrying && !autoGrabRetryTimeout) return;
      isAutoGrabRetrying = false;
      if (autoGrabRetryTimeout) {
        clearTimeout(autoGrabRetryTimeout);
        autoGrabRetryTimeout = null;
      }
      autoGrabAttemptCount = 0;
      updateAutoBookActionState();
      if (userInitiated) {
        if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = 'Stopped';
        addConsoleLog('🛑 Keep Trying cancelled by user.', 'warn');
        showToast(isBn() ? 'পুনরায় চেষ্টা থামানো হয়েছে।' : 'Keep Trying stopped.', 'info');
      }
    }

    if (autoBookKeepTryingToggle) {
      autoBookKeepTryingToggle.addEventListener('change', () => {
        if (!autoBookKeepTryingToggle.checked && isAutoGrabRetrying) {
          stopAutoGrabRetrying(true);
        }
      });
    }

    function setAutoBookMode(mode) {
      if (isAutoGrabRetrying) {
        stopAutoGrabRetrying(false);
      }
      currentMode = mode;
      updateAutoBookActionState();
    }

    if (autoBookTabNow) autoBookTabNow.addEventListener('click', () => setAutoBookMode('now'));
    if (autoBookTabSchedule) autoBookTabSchedule.addEventListener('click', () => setAutoBookMode('schedule'));
    if (autoBookModeHold) autoBookModeHold.addEventListener('change', () => updateAutoBookActionState());
    if (autoBookModeBuy) autoBookModeBuy.addEventListener('change', () => updateAutoBookActionState());

    // Initialize smart mode detection based on the default date
    if (autoBookDateInput && autoBookDateInput.value) {
      autoDetectModeFromDate(autoBookDateInput.value);
    } else {
      updateAutoBookActionState();
    }

    // 8. Console Logging Helper
    const autoBookConsoleClearBtn = document.getElementById('autoBookConsoleClearBtn');
    if (autoBookConsoleClearBtn) {
      autoBookConsoleClearBtn.addEventListener('click', () => {
        if (autoBookConsoleLogs) autoBookConsoleLogs.innerHTML = '';
        const banner = document.getElementById('autoBookGrabbedBanner');
        if (banner) banner.classList.add('hidden');
      });
    }

    function addConsoleLog(msg, type = 'info') {
      if (!autoBookConsoleBox || !autoBookConsoleLogs) return;
      autoBookConsoleBox.classList.remove('hidden');
      const time = new Date().toLocaleTimeString();

      let colorClass = 'text-slate-300';
      let icon = '<i class="fa-solid fa-angle-right text-[9px] text-slate-500 mt-0.5"></i>';
      let badge = '';

      if (type === 'success') {
        colorClass = 'text-emerald-300 font-semibold';
        icon = '<i class="fa-solid fa-circle-check text-xs text-emerald-400 mt-0.5"></i>';
        badge = '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">OK</span>';
      } else if (type === 'warn') {
        colorClass = 'text-amber-300';
        icon = '<i class="fa-solid fa-triangle-exclamation text-xs text-amber-400 mt-0.5"></i>';
        badge = '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-800 shrink-0">WAIT</span>';
      } else if (type === 'error') {
        colorClass = 'text-rose-300 font-bold';
        icon = '<i class="fa-solid fa-circle-xmark text-xs text-rose-400 mt-0.5"></i>';
        badge = '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-800 shrink-0">ERR</span>';
      }

      const line = document.createElement('div');
      line.className = `pt-1 pb-1 flex items-start gap-2 ${colorClass}`;
      line.innerHTML = `
        <span class="text-slate-500 text-[10px] select-none shrink-0 font-mono">[${time}]</span>
        ${badge}
        <div class="flex-1 leading-snug break-words">${msg}</div>
      `;
      autoBookConsoleLogs.appendChild(line);
      autoBookConsoleLogs.scrollTop = autoBookConsoleLogs.scrollHeight;
    }

    // Helpers: Clean Coach Name, Infer Class, Clean Seat Number
    function cleanCoachName(rawName) {
      if (!rawName) return 'Coach';
      let str = String(rawName).trim();
      str = str.replace(/\s*\([^)]*\)/g, '').trim();
      const letterMatch = str.match(/^[Cc]oach[-_\s]+([a-zA-Z\u0980-\u09FF]+[\w-]*)$/);
      if (letterMatch) {
        return letterMatch[1];
      }
      return str || 'Coach';
    }

    function inferClassFromCoachName(coachName, fallback = 'S_CHAIR') {
      const safeFallback = (fallback && fallback !== 'ANY' && fallback !== 'ALL') ? String(fallback).toUpperCase() : 'S_CHAIR';
      if (!coachName) return safeFallback;
      const upper = String(coachName).toUpperCase().trim();

      if (upper.includes('SNIGDHA')) return 'SNIGDHA';
      if (upper.includes('AC_B') || upper.includes('BERTH') || upper.includes('CABIN') || upper.includes('SLEEPER')) return 'AC_B';
      if (upper.includes('AC_S') || upper.includes('AC_C') || upper.includes('AC_CHAIR') || upper.includes('AC SEAT') || upper.includes('AC CHAIR')) return 'AC_S';
      if (upper.includes('S_CHAIR') || upper.includes('SHOVAN') || upper.includes('SHOVON') || upper.includes('CHAIR')) return 'S_CHAIR';
      if (upper.includes('F_SEAT') || upper.includes('FIRST SEAT')) return 'F_SEAT';
      if (upper.includes('F_BERTH') || upper.includes('FIRST BERTH')) return 'F_BERTH';
      if (upper.includes('SULOB') || upper.includes('SHULOBH')) return 'SULOB';

      // Do not guess or override class based on coach letters (e.g. KA, GA, CHA)
      return safeFallback;
    }

    function cleanSeatNumber(rawSeat) {
      if (!rawSeat) return '';
      const str = String(rawSeat).trim();
      const m = str.match(/^[a-zA-Z\u0980-\u09FF0-9]+-(.+)$/);
      if (m && m[1]) {
        return m[1].trim();
      }
      return str;
    }

    // 9. Smart Seat Allocation Algorithm (Keep Seats Together, Window/Aisle & Front/Middle/Back Seat Position Preferences)
    function allocateSmartSeats(coaches, count, prefs = {}) {
      let {
        keepTogether = true,
        positionPref = 'any',
        preferredClass = null,
        preferredClasses = null
      } = prefs;
      if (!Array.isArray(coaches) || coaches.length === 0) return null;

      // Extract section and side preferences from positionPref
      let sectionPref = 'any';
      let sidePref = 'any';
      if (['front', 'middle', 'back'].includes(positionPref)) {
        sectionPref = positionPref;
      } else if (['window', 'aisle'].includes(positionPref)) {
        sidePref = positionPref;
      }

      // Normalize preferred classes into an uppercase array
      let classFilterList = [];
      if (Array.isArray(preferredClasses) && preferredClasses.length > 0 && !preferredClasses.includes('ANY') && !preferredClasses.includes('ALL')) {
        classFilterList = preferredClasses.map(c => String(c).toUpperCase());
      } else if (preferredClass && preferredClass !== 'ANY' && preferredClass !== 'ALL') {
        classFilterList = [String(preferredClass).toUpperCase()];
      }

      function getCoachClass(c) {
        let cls = String(c.seat_class || c.class_name || '').toUpperCase().trim();
        if (!cls || cls === 'ANY' || cls === 'ALL') {
          cls = inferClassFromCoachName(c.coach_name || c.floor_name || '', 'S_CHAIR');
        }
        return cls;
      }

      // Filter coaches that have at least 1 seat available
      let candidates = coaches.filter(c => Number(c.available_seats || 0) > 0);
      if (candidates.length === 0) return null;

      if (classFilterList.length > 0) {
        const classFiltered = candidates.filter(c => classFilterList.includes(getCoachClass(c)));
        if (classFiltered.length > 0) candidates = classFiltered;
      }

      // Helper: Robust Bangladesh Railway seat position analyzer (calculates window, aisle, section accurately)
      function analyzeSeatGeometry(seat, coachClass, maxRow, totalSeats, seatIdx) {
        let isWindow = !!seat.is_window;
        let isAisle = !!seat.is_aisle_side;

        // If geometry flags are missing or undetermined, compute via Bangladesh Railway rake layout
        const col = Number(seat.col);
        const hasCol = !isNaN(col) && col >= 0;
        const cls = String(coachClass || seat.seat_class || '').toUpperCase();
        const is3Plus2 = ['SNIGDHA', 'AC_S', 'AC_CHAIR', 'AC_C'].includes(cls);

        if (hasCol) {
          if (is3Plus2) {
            // 5 seats per row (3 on one side, aisle, 2 on other side): col 0 and 4 are window; col 2 and 3 are aisle-facing
            isWindow = (col === 0 || col === 4);
            isAisle = (col === 2 || col === 3);
          } else {
            // Standard 2+2 layout (S_CHAIR, SHOVAN, SULOB, F_SEAT): col 0 and 3 are window; col 1 and 2 are aisle
            isWindow = (col === 0 || col === 3);
            isAisle = (col === 1 || col === 2);
          }
        } else {
          // Fallback via sequential seat number arithmetic for BR coaches
          const num = parseInt(String(seat.seat_number || seat.seat_name || '').replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > 0) {
            if (is3Plus2) {
              const mod = (num - 1) % 5;
              isWindow = (mod === 0 || mod === 4);
              isAisle = (mod === 2 || mod === 3);
            } else {
              const mod = (num - 1) % 4;
              isWindow = (mod === 0 || mod === 3);
              isAisle = (mod === 1 || mod === 2);
            }
          }
        }

        // Section classification (Front, Middle, Back)
        let section = 'middle';
        const r = Number(seat.row);
        if (maxRow > 2 && !isNaN(r) && r > 0) {
          const frontCut = Math.max(1, Math.ceil(maxRow / 3));
          const backCut = Math.max(frontCut + 1, Math.floor(maxRow * 2 / 3) + 1);
          if (r <= frontCut) section = 'front';
          else if (r >= backCut) section = 'back';
          else section = 'middle';
        } else {
          const num = parseInt(String(seat.seat_number || seat.seat_name || '').replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > 0 && totalSeats > 3) {
            const ratio = num / totalSeats;
            if (ratio <= 0.35) section = 'front';
            else if (ratio >= 0.65) section = 'back';
            else section = 'middle';
          } else {
            const idxRatio = seatIdx / Math.max(1, totalSeats - 1);
            if (idxRatio <= 0.35) section = 'front';
            else if (idxRatio >= 0.65) section = 'back';
            else section = 'middle';
          }
        }

        return { isWindow, isAisle, side: is3Plus2 ? (hasCol ? (col <= 2 ? 'left' : 'right') : ((num - 1) % 5 <= 2 ? 'left' : 'right')) : (hasCol ? (col <= 1 ? 'left' : 'right') : ((num - 1) % 4 <= 1 ? 'left' : 'right')), section };
      }

      // Helper: Score individual seat against user's seat position preferences
      function scoreSeatPosition(seat, coachClass, maxRow, totalSeats, seatIdx) {
        const geo = analyzeSeatGeometry(seat, coachClass, maxRow, totalSeats, seatIdx);
        let score = 0;

        // Side Preferences: Window (🪟) vs Aisle (🚶)
        if (sidePref === 'window') {
          if (geo.isWindow) score += 30;
          else if (geo.isAisle) score -= 10;
        } else if (sidePref === 'aisle') {
          if (geo.isAisle) score += 30;
          else if (geo.isWindow) score -= 10;
        }

        // Section Preferences: Front (🚅), Middle (🎯), Back (🚪)
        if (sectionPref !== 'any') {
          if (geo.section === sectionPref) {
            score += 25;
          }

          const r = Number(seat.row) || 1;
          if (sectionPref === 'front') {
            score += (maxRow - r) * 0.8;
          } else if (sectionPref === 'back') {
            score += r * 0.8;
          } else if (sectionPref === 'middle') {
            const mid = (maxRow + 1) / 2;
            score += (maxRow - Math.abs(r - mid)) * 0.8;
          }
        }

        return score;
      }

      // Strategy A: If keepTogether is true and count > 1, evaluate ALL contiguous candidate blocks
      // in the SAME ROW first (Row-wise first priority)
      if (keepTogether && count > 1) {
        let bestContiguousRun = null;
        let highestRunScore = -Infinity;

        for (const coach of candidates) {
          const seats = (coach.seats || []).filter(s => !s.is_blank && s.seat_number);
          if (seats.length === 0) continue;

          // Group seats by row
          const rowMap = new Map();
          for (const s of seats) {
            const r = s.row !== undefined && s.row !== null ? s.row : 1;
            if (!rowMap.has(r)) rowMap.set(r, []);
            rowMap.get(r).push(s);
          }

          const maxRow = Math.max(...seats.map(s => Number(s.row) || 1), 1);
          const totalCoachSeats = seats.length || 1;

          for (const [, rowSeats] of rowMap.entries()) {
            rowSeats.sort((a, b) => (Number(a.col) || 0) - (Number(b.col) || 0));

            // Find contiguous blocks of available seats in this row of length `count`
            // MUST HAVE SAME SIDE: all seats in the row run must be on the SAME side of the aisle
            let currentRun = [];
            for (let i = 0; i < rowSeats.length; i++) {
              const s = rowSeats[i];
              if (s.status === 'available') {
                const sGeo = analyzeSeatGeometry(s, coach.seat_class, maxRow, totalCoachSeats, i);
                if (currentRun.length > 0) {
                  const firstGeo = analyzeSeatGeometry(currentRun[0], coach.seat_class, maxRow, totalCoachSeats, 0);
                  // If side differs (e.g. one is left and one is across the aisle on the right), reset run to this seat
                  if (sGeo.side !== firstGeo.side) {
                    currentRun = [s];
                  } else {
                    currentRun.push(s);
                  }
                } else {
                  currentRun.push(s);
                }

                if (currentRun.length === count) {
                  // Verify that ALL seats in this run strictly have the exact same side
                  const runSide = analyzeSeatGeometry(currentRun[0], coach.seat_class, maxRow, totalCoachSeats, 0).side;
                  const allSameSideInRow = currentRun.every(st => analyzeSeatGeometry(st, coach.seat_class, maxRow, totalCoachSeats, 0).side === runSide);

                  if (allSameSideInRow) {
                    // Score this contiguous run
                    let runScore = 100;
                    currentRun.forEach((seatItem, idx) => {
                      runScore += scoreSeatPosition(seatItem, coach.seat_class, maxRow, totalCoachSeats, idx);
                    });

                    // Bonus: if window preferred and at least 1 seat is window, add strong bonus
                    if (sidePref === 'window' && currentRun.some(st => analyzeSeatGeometry(st, coach.seat_class, maxRow, totalCoachSeats, 0).isWindow)) {
                      runScore += 20;
                    }
                    // Bonus: if aisle preferred and at least 1 seat is aisle
                    if (sidePref === 'aisle' && currentRun.some(st => analyzeSeatGeometry(st, coach.seat_class, maxRow, totalCoachSeats, 0).isAisle)) {
                      runScore += 20;
                    }

                    if (runScore > highestRunScore) {
                      highestRunScore = runScore;
                      bestContiguousRun = { coach, seats: [...currentRun], isContiguous: true, isSameSide: true };
                    }
                  }

                  // Slide by 1 seat to check overlapping runs in same row
                  currentRun.shift();
                }
              } else {
                currentRun = [];
              }
            }
          }
        }

        if (bestContiguousRun) {
          return bestContiguousRun;
        }

        // Strategy A.2: Fallback to SAME SIDE seats (left side or right side of aisle across nearby rows)
        let bestSameSideGroup = null;
        let highestSideScore = -Infinity;

        for (const coach of candidates) {
          const availSeats = (coach.seats || []).filter(s => !s.is_blank && s.seat_number && s.status === 'available');
          if (availSeats.length < count) continue;

          const maxRow = Math.max(...(coach.seats || []).map(s => Number(s.row) || 1), 1);
          const totalCoachSeats = (coach.seats || []).length || 1;

          // Group by side: 'left' vs 'right'
          const leftSeats = [];
          const rightSeats = [];
          availSeats.forEach((s, idx) => {
            const geo = analyzeSeatGeometry(s, coach.seat_class, maxRow, totalCoachSeats, idx);
            if (geo.side === 'left') leftSeats.push(s);
            else rightSeats.push(s);
          });

          for (const sideSeats of [leftSeats, rightSeats]) {
            if (sideSeats.length >= count) {
              // Sort by row proximity first, then score
              sideSeats.sort((a, b) => {
                const rA = Number(a.row) || 1;
                const rB = Number(b.row) || 1;
                if (rA !== rB) return rA - rB;
                return (Number(a.col) || 0) - (Number(b.col) || 0);
              });

              // Slide window of `count` seats to find minimal row spread
              for (let i = 0; i <= sideSeats.length - count; i++) {
                const group = sideSeats.slice(i, i + count);
                const minR = Math.min(...group.map(s => Number(s.row) || 1));
                const maxR = Math.max(...group.map(s => Number(s.row) || 1));
                const rowSpread = maxR - minR; // closer rows are preferred!

                let sideScore = 100 - (rowSpread * 10);
                group.forEach((sItem, idx) => {
                  sideScore += scoreSeatPosition(sItem, coach.seat_class, maxRow, totalCoachSeats, idx);
                });

                if (sideScore > highestSideScore) {
                  highestSideScore = sideScore;
                  bestSameSideGroup = { coach, seats: group, isContiguous: false, isSameSide: true };
                }
              }
            }
          }
        }

        if (bestSameSideGroup) {
          return bestSameSideGroup;
        }
      }

      // Strategy B: Allocate best available seats within a single coach scored individually
      candidates.sort((a, b) => Number(b.available_seats || 0) - Number(a.available_seats || 0));

      for (const coach of candidates) {
        const seats = (coach.seats || []).filter(s => !s.is_blank && s.seat_number && s.status === 'available');
        if (seats.length >= count) {
          const maxRow = Math.max(...(coach.seats || []).map(s => Number(s.row) || 1), 1);
          const totalCoachSeats = (coach.seats || []).length || 1;

          seats.sort((a, b) => {
            const scoreA = scoreSeatPosition(a, coach.seat_class, maxRow, totalCoachSeats, seats.indexOf(a));
            const scoreB = scoreSeatPosition(b, coach.seat_class, maxRow, totalCoachSeats, seats.indexOf(b));
            return scoreB - scoreA;
          });

          return {
            coach,
            seats: seats.slice(0, count),
            isContiguous: false
          };
        }
      }

      // Strategy C: Fallback to whatever seats are available
      const fallbackCoach = candidates[0];
      const fallbackSeats = (fallbackCoach.seats || []).filter(s => !s.is_blank && s.seat_number && s.status === 'available');
      if (fallbackSeats.length > 0) {
        return {
          coach: fallbackCoach,
          seats: fallbackSeats.slice(0, count),
          isContiguous: false
        };
      }

      return null;
    }

    // 9b. Cloudflare Turnstile Background Bridge Token Grabbing System
    async function ensureFreshTurnstileToken(onProgress) {
      let cft = (typeof getStoredCftResponse === 'function') ? getStoredCftResponse() : '';

      // Check server token-status first to see if server already has an active, recent CFT token
      try {
        const stRes = await fetch('/api/auth/token-status');
        if (stRes.ok) {
          const stData = await stRes.json();
          if (stData.has_cft && stData.cft_response) {
            cft = stData.cft_response;
            try { localStorage.setItem('railway_cft_response', cft); } catch (e) {}
            // If token is recent (< 180s old), reuse it immediately for instant response
            if (stData.cft_age_seconds !== null && stData.cft_age_seconds < 180) {
              if (onProgress) onProgress('active', cft);
              return cft;
            }
          }
        }
      } catch (e) {}

      // Trigger background bridge iframe to grab a fresh Cloudflare Turnstile token
      if (onProgress) onProgress('grabbing');
      if (typeof requestBackgroundTurnstileToken === 'function') {
        requestBackgroundTurnstileToken();
      }

      // Fast-poll for up to 800ms (checking every 150ms)
      for (let poll = 0; poll < 6; poll++) {
        await new Promise(r => setTimeout(r, 150));

        // 1. Instant check from bridge postMessage
        let fresh = window._freshBridgeCft || '';
        if (fresh && fresh !== cft) {
          cft = fresh;
          window._freshBridgeCft = '';
          try { localStorage.setItem('railway_cft_response', cft); } catch (e) {}
          if (onProgress) onProgress('acquired', cft);
          return cft;
        }

        // 2. Check server /api/auth/token-status
        try {
          const stRes = await fetch('/api/auth/token-status');
          if (stRes.ok) {
            const stData = await stRes.json();
            if (stData.has_cft && stData.cft_response && stData.cft_response !== cft) {
              cft = stData.cft_response;
              try { localStorage.setItem('railway_cft_response', cft); } catch (e) {}
              if (onProgress) onProgress('acquired', cft);
              return cft;
            }
          }
        } catch (e) {}
      }

      if (cft) {
        if (onProgress) onProgress('using_existing', cft);
        return cft;
      }

      if (onProgress) onProgress('timeout');
      return '';
    }

    // Helper: Adaptive smart retry delay (08:00 AM rush = 1.0s turbo scan; off-peak = 1.5s to 2.2s for fastest seat capture)
    function getAdaptiveRetryDelay(attempt) {
      const now = new Date();
      const hr = now.getHours();
      const min = now.getMinutes();
      const isRushHour = (hr === 7 && min >= 58) || (hr === 8 && min <= 8);
      if (isRushHour) {
        return 1000; // Turbo 1.0s retry during 8:00 AM ticket drop rush
      }
      // Off-peak fast adaptive: 1500ms base with slight 0-200ms jitter
      const base = Math.min(2200, 1500 + Math.floor((attempt || 1) / 8) * 200);
      const jitter = Math.floor(Math.random() * 200);
      return base + jitter;
    }

    // 10. Execute Auto-Grab Now (with 100% Exact Coach and Seat Grabbing via Turnstile Bridge)
    async function executeAutoGrabNow() {
      const fromCity = (autoBookFromInput?.value || '').trim();
      const toCity = (autoBookToInput?.value || '').trim();
      const journeyDate = autoBookDateInput?.value || '';

      // Multi-select train & class arrays
      const targetTrains = (selectedAutoBookTrains.includes('ALL') || selectedAutoBookTrains.length === 0)
        ? ['ALL']
        : [...selectedAutoBookTrains];
      const targetClasses = (selectedAutoBookClasses.includes('ANY') || selectedAutoBookClasses.length === 0)
        ? ['ANY']
        : [...selectedAutoBookClasses];

      // Primary parameters for backward-compatible server query
      const primarySeatClass = targetClasses.includes('ANY') ? 'ANY' : targetClasses.join(',');
      const primaryTrainName = targetTrains.includes('ALL') ? '' : targetTrains.join(',');

      const count = selectedSeatsCount;
      const keepTogether = autoBookKeepTogetherToggle ? autoBookKeepTogetherToggle.checked : true;
      const positionPref = autoBookPositionPref?.value || 'any';
      const holdOnly = isHoldOnlyMode();       // true = Hold seat only, false = Buy (go to OTP)
      const autoProceed = !holdOnly;           // legacy compat: autoProceed = go to OTP
      const soundAlarm = autoBookSoundAlarmToggle ? autoBookSoundAlarmToggle.checked : true;
      const keepTrying = autoBookKeepTryingToggle ? autoBookKeepTryingToggle.checked : false;

      if (!fromCity || !toCity) {
        showToast(isBn() ? 'অনুগ্রহ করে স্টেশন নির্বাচন করুন।' : 'Please specify departure and arrival stations.', 'error');
        stopAutoGrabRetrying(false);
        return;
      }
      if (!journeyDate) {
        showToast(isBn() ? 'অনুগ্রহ করে ভ্রমণের তারিখ নির্বাচন করুন।' : 'Please choose a journey date.', 'error');
        stopAutoGrabRetrying(false);
        return;
      }

      if (keepTrying) {
        isAutoGrabRetrying = true;
        autoGrabAttemptCount++;
      } else {
        isAutoGrabRetrying = false;
        autoGrabAttemptCount = 1;
      }
      updateAutoBookActionState();

      if (autoGrabAttemptCount <= 1) {
        if (autoBookConsoleLogs) autoBookConsoleLogs.innerHTML = '';
        const banner = document.getElementById('autoBookGrabbedBanner');
        if (banner) banner.classList.add('hidden');
      }
      if (autoBookConsoleStatus) {
        if (isAutoGrabRetrying && autoGrabAttemptCount > 1) {
          autoBookConsoleStatus.textContent = `Retrying #${autoGrabAttemptCount}`;
          autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-amber-950/80 text-[10px] font-bold text-amber-300 border border-amber-800 animate-pulse';
        } else {
          autoBookConsoleStatus.textContent = 'Scanning...';
          autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-cyan-950/80 text-[10px] font-bold text-cyan-300 border border-cyan-800 animate-pulse';
        }
      }

      const attemptPrefix = (isAutoGrabRetrying && autoGrabAttemptCount > 1) ? `[Attempt #${autoGrabAttemptCount}] ` : '';
      const trainDisplayStr = targetTrains.includes('ALL') ? 'Any Train' : targetTrains.join(', ');
      const classDisplayStr = targetClasses.includes('ANY') ? 'Any Class' : targetClasses.join(', ');
      const posMap = {
        'window': 'Window (জানালা 🪟)',
        'aisle': 'Aisle (আইল 🚶)',
        'front': 'Front Side (সামনে 🚅)',
        'middle': 'Middle (মাঝে 🎯)',
        'back': 'Back Side (পেছনে 🚪)',
        'any': 'Any Position'
      };
      const posDisplayStr = posMap[positionPref] || 'Any Position';
      addConsoleLog(`${attemptPrefix}[1/4] 🔍 Initiating auto-grab for ${fromCity} ➔ ${toCity} on ${journeyDate} (${trainDisplayStr} | ${classDisplayStr} | ${posDisplayStr})...`);

      if (autoBookActionBtn && !isAutoGrabRetrying) autoBookActionBtn.disabled = true;

      try {
        // Step 1: Turnstile Token Grabbing System for 100% exact live seats
        addConsoleLog(`[1/4] 🛡️ Connecting to Cloudflare Turnstile token grabbing bridge...`, 'info');
        let cftToken = '';
        await ensureFreshTurnstileToken((status, token) => {
          if (status === 'active') {
            cftToken = token;
            addConsoleLog(`[1/4] 🔑 Active Turnstile token ready (${token.substring(0, 10)}...${token.slice(-6)})!`, 'success');
          } else if (status === 'grabbing') {
            addConsoleLog(`[1/4] ⏳ Grabbing fresh Turnstile token from Railway bridge...`, 'info');
          } else if (status === 'acquired') {
            cftToken = token;
            addConsoleLog(`[1/4] ⚡ Fresh Turnstile token grabbed (${token.substring(0, 10)}...${token.slice(-6)})!`, 'success');
          } else if (status === 'using_existing') {
            cftToken = token;
            addConsoleLog(`[1/4] 🔑 Using cached Turnstile session token.`, 'info');
          }
        });

        const token = getAuthToken();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        if (cftToken) headers['x-cft-response'] = cftToken;

        const layoutPayload = {
          from_city: fromCity,
          to_city: toCity,
          date_of_journey: journeyDate,
          seat_class: primarySeatClass,
          train_name: primaryTrainName,
          cft_response: cftToken || ''
        };

        addConsoleLog(`[2/4] 🚆 Querying official Railway server for live coach layout & available seats...`, 'info');
        let res = await fetch('/api/live-coach-layout', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(layoutPayload)
        });
        let json = await res.json();

        // If turnstile was challenged, retry once with refreshed token
        if (json && (!json.live || json.requires_turnstile) && !cftToken) {
          addConsoleLog(`[2/4] 🛡️ Official Railway server challenged with Turnstile. Capturing bridge token...`, 'warn');
          if (typeof requestBackgroundTurnstileToken === 'function') requestBackgroundTurnstileToken();
          for (let p = 0; p < 15; p++) {
            await new Promise(r => setTimeout(r, 200));
            const fresh = window._freshBridgeCft || getStoredCftResponse();
            if (fresh) {
              cftToken = fresh;
              layoutPayload.cft_response = cftToken;
              headers['x-cft-response'] = cftToken;
              const retryRes = await fetch('/api/live-coach-layout', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(layoutPayload)
              });
              if (retryRes.ok) {
                const retryJson = await retryRes.json();
                if (retryJson.live) {
                  json = retryJson;
                  addConsoleLog(`[2/4] 🎯 Verified 100% Live official seat layout with fresh Turnstile token!`, 'success');
                  break;
                }
              }
            }
          }
        }

        if (!json || !json.data || !Array.isArray(json.data.coaches) || json.data.coaches.length === 0) {
          addConsoleLog(`[2/4] ⚠️ No live coach layout returned from Railway for this query.`, 'warn');
          if (keepTrying && isAutoGrabRetrying) {
            const nextAttempt = autoGrabAttemptCount + 1;
            const delayMs = getAdaptiveRetryDelay(autoGrabAttemptCount);
            const delaySec = (delayMs / 1000).toFixed(1);
            addConsoleLog(`🔄 [Keep Trying Active] Waiting ${delaySec}s before attempt #${nextAttempt}...`, 'info');
            if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = `Retrying (#${autoGrabAttemptCount})...`;
            updateAutoBookActionState();
            autoGrabRetryTimeout = setTimeout(() => {
              executeAutoGrabNow();
            }, delayMs);
            return;
          }
          if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = 'No Seats';
          showToast(isBn() ? 'এই রুটে সিটের তথ্য পাওয়া যায়নি।' : 'No available seats found right now.', 'info');
          stopAutoGrabRetrying(false);
          return;
        }

        const coaches = json.data.coaches;

        // Filter coaches matching any of the user's selected classes (or any if 'ANY')
        const isAnyClassSelected = targetClasses.includes('ANY') || targetClasses.length === 0;
        const classFiltered = !isAnyClassSelected
          ? coaches.filter(c => targetClasses.map(x => x.toUpperCase()).includes((c.seat_class || '').toUpperCase()) && Number(c.available_seats || 0) > 0)
          : coaches.filter(c => Number(c.available_seats || 0) > 0);

        const availableCoaches = classFiltered.length > 0 ? classFiltered : coaches.filter(c => Number(c.available_seats || 0) > 0);
        const totalAvail = availableCoaches.reduce((sum, c) => sum + Number(c.available_seats || 0), 0);

        if (totalAvail < count) {
          addConsoleLog(`[2/4] ⚠️ Insufficient seats available (found ${totalAvail}, needed ${count}).`, 'warn');
          if (keepTrying && isAutoGrabRetrying) {
            const nextAttempt = autoGrabAttemptCount + 1;
            const delayMs = getAdaptiveRetryDelay(autoGrabAttemptCount);
            const delaySec = (delayMs / 1000).toFixed(1);
            addConsoleLog(`🔄 [Keep Trying Active] Waiting ${delaySec}s before attempt #${nextAttempt}... (found ${totalAvail}/${count} seats)`, 'info');
            if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = `Retrying (#${autoGrabAttemptCount})...`;
            updateAutoBookActionState();
            autoGrabRetryTimeout = setTimeout(() => {
              executeAutoGrabNow();
            }, delayMs);
            return;
          }
          addConsoleLog(`💡 Tip: Switch to "Schedule Future Date" mode to watch for 08:00 AM drops!`, 'info');
          if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = 'Sold Out';
          showToast(isBn() ? `পর্যাপ্ত খালি সিট নেই (পাওয়া গেছে ${totalAvail}টি, প্রয়োজন ${count}টি)।` : `Insufficient seats available (found ${totalAvail}).`, 'info');
          stopAutoGrabRetrying(false);
          return;
        }

        const displayTrainName = json.train_name || (!targetTrains.includes('ALL') ? targetTrains[0] : 'Railway Train');
        if (json.live) {
          addConsoleLog(`[2/4] 🎯 100% Official Live Coach Map Verified! (${coaches.length} official bogies loaded directly from Railway server — exact seat numbers confirmed)`, 'success');
        } else if (json.requires_turnstile) {
          addConsoleLog(`[2/4] 🔄 Live availability confirmed (${totalAvail} seats on ${displayTrainName}). Turnstile refresh needed for exact seat map — proceeding with availability data.`, 'info');
        } else {
          addConsoleLog(`[2/4] 🚆 Live availability confirmed on Railway route (${totalAvail} seats available on ${displayTrainName}).`, 'info');
        }

        const allocation = allocateSmartSeats(coaches, count, {
          keepTogether,
          positionPref,
          preferredClasses: targetClasses
        });
        if (!allocation || allocation.seats.length === 0) {
          addConsoleLog(`[3/4] ⚠️ Could not allocate seats matching your strict preferences.`, 'warn');
          if (keepTrying && isAutoGrabRetrying) {
            const nextAttempt = autoGrabAttemptCount + 1;
            const delayMs = getAdaptiveRetryDelay(autoGrabAttemptCount);
            const delaySec = (delayMs / 1000).toFixed(1);
            addConsoleLog(`🔄 [Keep Trying Active] Waiting ${delaySec}s before attempt #${nextAttempt}...`, 'info');
            if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = `Retrying (#${autoGrabAttemptCount})...`;
            updateAutoBookActionState();
            autoGrabRetryTimeout = setTimeout(() => {
              executeAutoGrabNow();
            }, delayMs);
            return;
          }
          stopAutoGrabRetrying(false);
          return;
        }

        const { coach, seats, isContiguous } = allocation;
        const rawCoachName = coach.coach_name || coach.floor_name || 'Coach';
        const coachName = cleanCoachName(rawCoachName);

        // Resolve exact class: coach.seat_class -> seat.seat_class -> json.matched_seat_class -> targetClasses -> infer from coachName -> 'S_CHAIR'
        let candidateClass = coach.seat_class;
        if (!candidateClass || candidateClass === 'ANY' || candidateClass === 'ALL') {
          candidateClass = seats.find(s => s && s.seat_class && s.seat_class !== 'ANY' && s.seat_class !== 'ALL')?.seat_class;
        }
        if (!candidateClass || candidateClass === 'ANY' || candidateClass === 'ALL') {
          candidateClass = json.matched_seat_class;
        }
        if (!candidateClass || candidateClass === 'ANY' || candidateClass === 'ALL') {
          candidateClass = targetClasses.find(c => c && c !== 'ANY' && c !== 'ALL');
        }
        if (!candidateClass || candidateClass === 'ANY' || candidateClass === 'ALL') {
          candidateClass = inferClassFromCoachName(rawCoachName, 'S_CHAIR');
        }
        const allocatedClass = (candidateClass && candidateClass !== 'ANY' && candidateClass !== 'ALL') ? String(candidateClass).toUpperCase().trim() : 'S_CHAIR';

        // Use the coach's specific trip_id if available (per-class trip_id from Railway)
        const coachTripId = coach.trip_id || json.trip_id || '';
        const coachTripRouteId = coach.trip_route_id || json.trip_route_id || '';
        const seatNumbersOnly = seats.map(s => {
          const num = cleanSeatNumber(s.display_number || s.seat_number || s.seat_name);
          return num;
        }).filter(Boolean);
        const seatNamesStr = seatNumbersOnly.join(',');

        if (json.live) {
          addConsoleLog(`[3/4] 🎯 <b>EXACT SEAT(S) GRABBED:</b> <span class="text-white font-bold">${displayTrainName}</span> • Coach <span class="text-emerald-400 font-bold">${coachName}</span> (<span class="text-cyan-300 font-bold">${allocatedClass}</span>) • Seat(s): <span class="text-amber-300 font-bold">${seatNumbersOnly.join(', ')}</span> (${isContiguous ? 'Contiguous in Same Row' : 'Available Seats'})`, 'success');
        } else {
          addConsoleLog(`[3/4] ✅ <b>TARGET ALLOCATED:</b> Coach <span class="text-emerald-400 font-bold">${coachName}</span> (<span class="text-cyan-300 font-bold">${allocatedClass}</span>) • Seat(s): <span class="text-amber-300 font-bold">${seatNumbersOnly.join(', ')}</span> (${isContiguous ? 'Contiguous' : 'Available'})`, 'success');
          addConsoleLog(`[3/4] ⚡ Blank Coach & Seat Auto-Seeker Active: If Coach ${coachName} is not in the railway layout or is full, system will auto-switch to a coach with blank seats and select them automatically!`, 'info');
        }

        if (soundAlarm) {
          playAlarmChime();
        }

        const trainName = json.train_name || (targetTrain !== 'ALL' ? targetTrain : '');
        const trainModel = json.train_model || targetTrainModel || json.data.train_model || '';

        // Build Booking URL with auto-book parameters and the exact allocated class
        // Include the class-specific trip_id so Railway's Angular app can navigate directly to the right coach
        const baseBookingUrl = buildShohozBookingUrl(fromCity, toCity, journeyDate, allocatedClass);
        const urlObj = new URL(baseBookingUrl);
        if (trainName) urlObj.searchParams.set('train', trainName);
        if (trainModel) urlObj.searchParams.set('train_model', trainModel);
        urlObj.searchParams.set('coach', coachName);
        urlObj.searchParams.set('seats', seatNamesStr);
        urlObj.searchParams.set('seats_count', String(count));
        urlObj.searchParams.set('auto_coach', '1');
        // Pass class-specific trip_id so Tampermonkey can use it for direct seat-layout lookup
        if (coachTripId) urlObj.searchParams.set('trip_id', coachTripId);
        if (coachTripRouteId) urlObj.searchParams.set('trip_route_id', coachTripRouteId);
        if (keepTogether) {
          urlObj.searchParams.set('keep_together', '1');
        } else {
          urlObj.searchParams.set('keep_together', '0');
        }
        if (positionPref && positionPref !== 'any') {
          urlObj.searchParams.set('position', positionPref);
          if (['front', 'middle', 'back'].includes(positionPref)) {
            urlObj.searchParams.set('section', positionPref);
          }
        }
        // Hold Only mode: select seat but do NOT proceed to OTP/payment
        // Buy Now mode: auto-click Continue Purchase and go to OTP
        if (holdOnly) {
          urlObj.searchParams.set('autobook', '1');
          urlObj.searchParams.set('hold_only', '1');
        } else if (autoProceed) {
          urlObj.searchParams.set('autobook', '1');
        }

        const finalUrl = urlObj.toString();
        const modeLabel = holdOnly ? '🖐️ Hold Only' : '🛒 Buy Now';

        // Showcase in Top Grabbed Banner inside Activity Console
        const grabBanner = document.getElementById('autoBookGrabbedBanner');
        if (grabBanner) {
          grabBanner.classList.remove('hidden');
          const cVal = document.getElementById('grabbedCoachVal');
          const clVal = document.getElementById('grabbedClassVal');
          const sVal = document.getElementById('grabbedSeatsVal');
          const tBadge = document.getElementById('grabbedTrainBadge');
          const linkBox = document.getElementById('grabbedActionLinkContainer');
          if (cVal) cVal.textContent = coachName;
          if (clVal) clVal.textContent = allocatedClass;
          if (sVal) sVal.textContent = seatNumbersOnly.join(', ');
          if (tBadge) tBadge.textContent = displayTrainName;
          if (linkBox) {
            linkBox.innerHTML = `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow transition cursor-pointer">🚀 Open Railway Tab</a>`;
          }
        }

        addConsoleLog(`[4/4] 🚀 Directing to Bangladesh Railway server (${modeLabel})...`, 'success');
        if (autoBookConsoleStatus) {
          autoBookConsoleStatus.textContent = holdOnly ? 'Held! 🖐️' : 'Grabbed & Redirecting!';
          autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-emerald-900/80 text-[10px] font-bold text-emerald-300 border border-emerald-700 animate-pulse';
        }

        showToast(isBn() ? `⚡ ${count}টি সিট বরাদ্দ করা হয়েছে (${displayTrainName} - ${coachName}: ${seatNumbersOnly.join(', ')})! রেলওয়ে পেজে নিয়ে যাওয়া হচ্ছে...` : `⚡ ${count} seats allocated (${displayTrainName} - ${coachName}: ${seatNumbersOnly.join(', ')})! Launching Railway...`, 'success');

        stopAutoGrabRetrying(false);

        let win = null;
        try {
          win = window.open(finalUrl, '_blank');
        } catch (e) {}

        const isBlocked = !win || win.closed || typeof win.closed === 'undefined';
        if (isBlocked) {
          addConsoleLog(`[4/4] ⚠️ Browser popup window was blocked! Your dashboard will stay open.`, 'warn');
          addConsoleLog(`<div class="my-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner"><span class="text-xs text-amber-600 dark:text-amber-400 font-bold">Allocated: ${displayTrainName} | ${coachName} (${seatNumbersOnly.join(', ')})</span><a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs shadow-md transition transform active:scale-95 cursor-pointer">🚀 Click Here to Open Railway Page</a></div>`, 'info');
        } else {
          addConsoleLog(`[4/4] ✅ Railway opened in a new tab! Dashboard will remain active.`, 'success');
          addConsoleLog(`<div class="my-1.5"><a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow transition cursor-pointer">🔗 Re-open Railway Tab</a></div>`, 'info');
        }
        // Send Telegram alert if user has linked Telegram
        try {
          const tgConfig = typeof getTelegramConfig === 'function' ? getTelegramConfig() : null;
          if (tgConfig && tgConfig.chat_id) {
            const tgMsg = `⚡ <b>SEAT HELD ON RAILWAY!</b>\n\n` +
                          `🚆 <b>Train:</b> ${displayTrainName}\n` +
                          `💺 <b>Coach & Seat:</b> Coach ${coachName} (${allocatedClass}) — Seat(s): ${seatNumbersOnly.join(', ')}\n` +
                          `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                          `📅 <b>Date:</b> ${journeyDate}\n` +
                          `⏱️ <i>Held for ~5 minutes. Complete purchase immediately!</i>`;
            fetch('/api/telegram/send-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: tgConfig.chat_id,
                message: tgMsg,
                bookUrl: finalUrl
              })
            }).catch(() => {});
          }
        } catch (e) {}

        // Send Browser Web Notification
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('⚡ RailSeat BD — Seat Grabbed!', {
              body: `${displayTrainName} (Coach ${coachName} - ${seatNumbersOnly.join(', ')}) held on Railway!`,
              icon: '/favicon.ico'
            });
          }
        } catch (e) {}

      } catch (err) {
        addConsoleLog(`❌ Error executing auto-grab: ${err.message}`, 'error');
        if (keepTrying && isAutoGrabRetrying) {
          const nextAttempt = autoGrabAttemptCount + 1;
          addConsoleLog(`🔄 [Keep Trying Active] Query interrupted. Waiting 3s before attempt #${nextAttempt}...`, 'warn');
          if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = `Retrying (#${autoGrabAttemptCount})...`;
          updateAutoBookActionState();
          autoGrabRetryTimeout = setTimeout(() => {
            executeAutoGrabNow();
          }, 3000);
          return;
        }
        if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = 'Error';
        stopAutoGrabRetrying(false);
      } finally {
        if (!isAutoGrabRetrying) {
          if (autoBookActionBtn) autoBookActionBtn.disabled = false;
        }
      }
    }

    let isHeadlessRadarActive = false;
    let headlessRadarTimer = null;
    let headlessRadarAttemptCount = 0;

    function stopHeadlessRadar(showNotice = true) {
      if (headlessRadarTimer) {
        clearTimeout(headlessRadarTimer);
        headlessRadarTimer = null;
      }
      isHeadlessRadarActive = false;
      headlessRadarAttemptCount = 0;
      if (headlessGrabNowBtn) {
        headlessGrabNowBtn.disabled = false;
        headlessGrabNowBtn.className = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-700 hover:from-teal-500 hover:to-emerald-600 text-white font-extrabold text-xs shadow-md shadow-emerald-600/20 hover:scale-[1.01] active:scale-95 transition flex items-center justify-center space-x-1.5 cursor-pointer';
      }
      if (headlessGrabNowIcon) headlessGrabNowIcon.className = 'fa-solid fa-cloud-arrow-down text-emerald-200';
      if (headlessGrabNowText) headlessGrabNowText.textContent = isBn() ? '📱 হেডলেস কার্ট হোল্ড' : '📱 1-Tap Headless Cart Hold';
      if (autoBookConsoleStatus && autoBookConsoleStatus.textContent.includes('Radar')) {
        autoBookConsoleStatus.textContent = 'Idle';
        autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-bold text-slate-300 border border-slate-700';
      }
      if (showNotice) {
        showToast(isBn() ? 'হেডলেস রাডার পর্যবেক্ষণ বন্ধ করা হয়েছে।' : 'Headless Radar watcher stopped.', 'info');
      }
    }

    // 10b. Execute 1-Tap Headless Mobile Grab (Cart Hold + Telegram Alert)
    async function executeHeadlessMobileGrabNow() {
      if (isHeadlessRadarActive) {
        stopHeadlessRadar(true);
        return;
      }

      const fromInputEl = document.getElementById('fromInput');
      const toInputEl = document.getElementById('toInput');
      const dateInputEl = document.getElementById('dateInput');

      let fromCity = (autoBookFromInput?.value || '').trim();
      let toCity = (autoBookToInput?.value || '').trim();
      let journeyDate = autoBookDateInput?.value || '';

      if (!fromCity && fromInputEl?.value) {
        fromCity = fromInputEl.value.trim();
        if (autoBookFromInput) autoBookFromInput.value = fromCity;
      }
      if (!toCity && toInputEl?.value) {
        toCity = toInputEl.value.trim();
        if (autoBookToInput) autoBookToInput.value = toCity;
      }
      if (!journeyDate && dateInputEl?.value) {
        journeyDate = dateInputEl.value.trim();
        if (autoBookDateInput) autoBookDateInput.value = journeyDate;
      }

      const targetTrains = (selectedAutoBookTrains.includes('ALL') || selectedAutoBookTrains.length === 0)
        ? ['ALL']
        : [...selectedAutoBookTrains];
      const targetClasses = (selectedAutoBookClasses.includes('ANY') || selectedAutoBookClasses.length === 0)
        ? ['ANY']
        : [...selectedAutoBookClasses];

      const count = selectedSeatsCount;
      const keepTrying = autoBookKeepTryingToggle ? autoBookKeepTryingToggle.checked : true;

      if (!fromCity || !toCity) {
        showToast(isBn() ? 'অনুগ্রহ করে প্রস্থান ও গন্তব্য স্টেশন নির্বাচন করুন।' : 'Please specify departure and arrival stations.', 'error');
        return;
      }
      if (!journeyDate) {
        showToast(isBn() ? 'অনুগ্রহ করে ভ্রমণের তারিখ নির্বাচন করুন।' : 'Please choose a journey date.', 'error');
        return;
      }

      if (autoBookConsoleBox) autoBookConsoleBox.classList.remove('hidden');
      if (headlessRadarAttemptCount === 0 && autoBookConsoleLogs) autoBookConsoleLogs.innerHTML = '';
      if (autoBookConsoleStatus) {
        autoBookConsoleStatus.textContent = headlessRadarAttemptCount > 0 ? `Radar Watcher (#${headlessRadarAttemptCount + 1})` : 'Headless Grabbing...';
        autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-teal-950/80 text-[10px] font-bold text-teal-300 border border-teal-800 animate-pulse';
      }

      const attemptNum = headlessRadarAttemptCount + 1;
      const attemptPrefix = headlessRadarAttemptCount > 0 ? `[Attempt #${attemptNum}] ` : '';

      addConsoleLog(`${attemptPrefix}[1/3] 📱 <b>Executing 1-Tap Headless Grab:</b> ${fromCity} ➔ ${toCity} on ${journeyDate} (${targetClasses.join(', ')} | ${count} seats)...`, 'info');
      addConsoleLog(`${attemptPrefix}[1/3] ⚡ Dual-Method Engine active (Method 1: Direct API, Method 2: Headless Browser). Zero phone battery or CPU used.`, 'info');

      try {
        const tgConfig = typeof getTelegramConfig === 'function' ? getTelegramConfig() : null;
        const authToken = typeof getAuthToken === 'function' ? getAuthToken() : '';
        const grabPayload = {
          from_city: fromCity,
          to_city: toCity,
          date_of_journey: journeyDate,
          train_name: targetTrains.includes('ALL') ? '' : targetTrains.join(','),
          seat_class: targetClasses.includes('ANY') ? 'ANY' : targetClasses.join(','),
          seats_count: count,
          method: 'auto',
          telegram_chat_id: tgConfig?.chat_id || ''
        };

        // Attach raw Shohoz JWT only if stored explicitly as a JWT (starts with eyJ)
        const candTok = (localStorage.getItem('token') || '').trim();
        if (candTok.startsWith('eyJ')) {
          grabPayload.token = candTok;
        }

        const reqHeaders = { 'Content-Type': 'application/json' };
        if (authToken) reqHeaders['Authorization'] = `Bearer ${authToken}`;

        if (headlessGrabNowBtn) headlessGrabNowBtn.disabled = true;
        if (headlessGrabNowIcon) headlessGrabNowIcon.className = 'fa-solid fa-spinner fa-spin text-amber-300';
        if (headlessGrabNowText) headlessGrabNowText.textContent = isBn() ? 'লক করা হচ্ছে...' : 'Holding in Cart...';

        let res = await fetch('/api/seat-grab', {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(grabPayload)
        });

        // Fallback for PHP environments without URL rewrite enabled
        if (res.status === 404) {
          res = await fetch('/api/seat-grab.php', {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(grabPayload)
          });
        }

        const data = await res.json();

        if (res.ok && data.success && data.details) {
          stopHeadlessRadar(false);
          const det = data.details;
          const displayTrainName = det.trainName || (targetTrains[0] !== 'ALL' ? targetTrains[0] : 'Intercity Train');
          const displayCoach = cleanCoachName(det.coach || 'Target');
          const displaySeats = (det.seats || []).map(cleanSeatNumber).filter(Boolean);
          const seatsStr = displaySeats.length > 0 ? displaySeats.join(', ') : 'Allocated';
          const checkoutUrl = 'https://eticket.railway.gov.bd/booking/checkout';

          addConsoleLog(`[2/3] 🎉 <b>100% SUCCESS: SEATS SECURED IN OFFICIAL CART!</b>`, 'success');
          addConsoleLog(`[2/3] 🚆 Train: <span class="text-white font-bold">${displayTrainName}</span> • Coach: <span class="text-emerald-400 font-bold">${displayCoach}</span> • Seat(s): <span class="text-amber-300 font-bold">${seatsStr}</span> via <code>${det.method || data.method_used}</code>`, 'success');
          addConsoleLog(`[3/3] ⏳ <b>LOCKED IN CART FOR ~5 MINUTES!</b> Complete payment before the timer expires.`, 'warn');
          addConsoleLog(`[3/3] 📱 <b>Telegram Alert Dispatched:</b> Instant notification with 1-tap checkout button sent to your phone!`, 'info');

          // Highlight Banner inside Activity Console
          const grabBanner = document.getElementById('autoBookGrabbedBanner');
          if (grabBanner) {
            grabBanner.classList.remove('hidden');
            const cVal = document.getElementById('grabbedCoachVal');
            const clVal = document.getElementById('grabbedClassVal');
            const sVal = document.getElementById('grabbedSeatsVal');
            const tBadge = document.getElementById('grabbedTrainBadge');
            const linkBox = document.getElementById('grabbedActionLinkContainer');
            if (cVal) cVal.textContent = displayCoach;
            if (clVal) clVal.textContent = det.seatClass || grabPayload.seat_class;
            if (sVal) sVal.textContent = seatsStr;
            if (tBadge) tBadge.textContent = displayTrainName;
            if (linkBox) {
              linkBox.innerHTML = `<a href="${checkoutUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow transition cursor-pointer">💳 Pay Now (Checkout)</a>`;
            }
          }

          if (autoBookConsoleStatus) {
            autoBookConsoleStatus.textContent = 'Held in Cart! 🛒';
            autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-emerald-900/80 text-[10px] font-bold text-emerald-300 border border-emerald-700 animate-pulse';
          }

          if (autoBookSoundAlarmToggle && autoBookSoundAlarmToggle.checked) {
            playAlarmChime();
          }

          showToast(isBn() ? `🎉 সিট আপনার রেলওয়ে কার্টে লক করা হয়েছে! ৫ মিনিটের মধ্যে পেমেন্ট সম্পন্ন করুন।` : `🎉 Seats locked in your Railway cart! Complete payment within 5 minutes.`, 'success');
          return;
        }

        // Handle error / seat not found yet
        const reason = data.error || data.details?.reason || 'No available seats matching criteria at this moment';
        const isAuthErr = reason.toLowerCase().includes('session') || reason.toLowerCase().includes('token') || reason.toLowerCase().includes('login') || reason.toLowerCase().includes('unauthorized');

        if (isAuthErr) {
          addConsoleLog(`[2/3] ❌ <b>Railway Authentication Required:</b> ${reason}`, 'error');
          addConsoleLog(`💡 Please click <b>"Connect Live API"</b> at the top bar to pair your official Bangladesh Railway account.`, 'warn');
          if (autoBookConsoleStatus) {
            autoBookConsoleStatus.textContent = 'Auth Required';
            autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-rose-950/80 text-[10px] font-bold text-rose-300 border border-rose-800';
          }
          showToast(reason, 'error');
          stopHeadlessRadar(false);
          return;
        }

        addConsoleLog(`[2/3] ⚠️ Headless Grab attempt: ${reason}`, 'warn');

        if (keepTrying) {
          isHeadlessRadarActive = true;
          headlessRadarAttemptCount++;
          const delayMs = getAdaptiveRetryDelay(headlessRadarAttemptCount);
          const delaySec = (delayMs / 1000).toFixed(1);

          addConsoleLog(`🔄 [Radar Active] Route is monitored. Retrying in ${delaySec}s to grab instant drop (Attempt #${headlessRadarAttemptCount + 1})...`, 'info');
          if (autoBookConsoleStatus) {
            autoBookConsoleStatus.textContent = `Radar Watcher (#${headlessRadarAttemptCount})`;
            autoBookConsoleStatus.className = 'px-2 py-0.5 rounded-full bg-amber-950/80 text-[10px] font-bold text-amber-300 border border-amber-800 animate-pulse';
          }

          if (headlessGrabNowBtn) {
            headlessGrabNowBtn.disabled = false;
            headlessGrabNowBtn.className = 'w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 hover:from-rose-700 hover:to-red-800 text-white font-extrabold text-xs shadow-md shadow-rose-600/20 transition flex items-center justify-center space-x-1.5 cursor-pointer';
          }
          if (headlessGrabNowIcon) headlessGrabNowIcon.className = 'fa-solid fa-stop text-white';
          if (headlessGrabNowText) headlessGrabNowText.textContent = isBn() ? '⏹️ রাডার বন্ধ করুন' : '⏹️ Stop Radar Watcher';

          headlessRadarTimer = setTimeout(() => {
            executeHeadlessMobileGrabNow();
          }, delayMs);
          return;
        } else {
          addConsoleLog('💡 Tip: Keep "Keep trying if no seats are available" enabled above to let the radar auto-grab tickets the exact millisecond they drop!', 'info');
          if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = 'Sold Out';
          showToast(reason, 'info');
          stopHeadlessRadar(false);
        }
      } catch (err) {
        addConsoleLog(`❌ Headless Grab failed: ${err.message}`, 'error');
        if (autoBookConsoleStatus) autoBookConsoleStatus.textContent = 'Error';
        showToast(`Headless grab failed: ${err.message}`, 'error');
        stopHeadlessRadar(false);
      }
    }

    // 11. Schedule Auto-Book Task for Future Date
    function scheduleAutoBookTask() {
      const fromCity = (autoBookFromInput?.value || '').trim();
      const toCity = (autoBookToInput?.value || '').trim();
      const journeyDate = autoBookDateInput?.value || '';

      const targetTrains = (selectedAutoBookTrains.includes('ALL') || selectedAutoBookTrains.length === 0)
        ? ['ALL']
        : [...selectedAutoBookTrains];
      const targetClasses = (selectedAutoBookClasses.includes('ANY') || selectedAutoBookClasses.length === 0)
        ? ['ANY']
        : [...selectedAutoBookClasses];

      const seatClass = targetClasses.includes('ANY') ? 'ANY' : targetClasses.join(', ');
      const targetTrain = targetTrains.includes('ALL') ? 'ALL' : targetTrains.join(', ');

      const count = selectedSeatsCount;
      const keepTogether = autoBookKeepTogetherToggle ? autoBookKeepTogetherToggle.checked : true;
      const positionPref = autoBookPositionPref?.value || 'any';
      const holdOnly = isHoldOnlyMode();
      const autoProceed = !holdOnly;
      const soundAlarm = autoBookSoundAlarmToggle ? autoBookSoundAlarmToggle.checked : true;
      const keepTrying = autoBookKeepTryingToggle ? autoBookKeepTryingToggle.checked : true;

      if (!fromCity || !toCity) {
        showToast(isBn() ? 'অনুগ্রহ করে স্টেশন নির্বাচন করুন।' : 'Please specify departure and arrival stations.', 'error');
        return;
      }
      if (!journeyDate) {
        showToast(isBn() ? 'অনুগ্রহ করে ভ্রমণের তারিখ নির্বাচন করুন।' : 'Please choose a journey date.', 'error');
        return;
      }

      const newTask = {
        id: 'task_' + Date.now(),
        fromCity,
        toCity,
        journeyDate,
        seatClass,
        targetTrain,
        targetClasses,
        targetTrains,
        count,
        keepTogether,
        positionPref,
        holdOnly,
        autoProceed,
        soundAlarm,
        keepTrying,
        status: 'scheduled',
        createdAt: new Date().toISOString()
      };

      autoBookTasks.unshift(newTask);
      saveTasks();
      renderTasks();

      const taskModeText = holdOnly ? (isBn() ? 'সিট হোল্ড' : 'Seat Hold') : (isBn() ? 'অটো-বুক' : 'Auto-Book');
      const posNotice = positionPref !== 'any' ? ` (${positionPref.toUpperCase()})` : '';
      showToast(isBn() ? `⏰ ${taskModeText} টাস্ক শিডিউল করা হয়েছে! সিট রিলিজ হওয়ার সাথে সাথে সক্রিয় হবে।` : `⏰ ${taskModeText} task scheduled! Watcher will trigger when tickets drop.`, 'success');
      addConsoleLog(`⏰ Scheduled task created for ${fromCity} ➔ ${toCity} on ${journeyDate} (${count} seats, ${seatClass}, ${targetTrain}${posNotice}, ${holdOnly ? '🖐️ Hold' : '🛒 Buy'})`, 'success');
    }

    function saveTasks() {
      try {
        localStorage.setItem('railseat_autobook_tasks', JSON.stringify(autoBookTasks));
      } catch (e) {}
    }

    // 12. Render Tasks List
    function renderTasks() {
      if (!autoBookTasksList) return;
      if (autoBookTasksBadge) autoBookTasksBadge.textContent = String(autoBookTasks.length);

      if (autoBookTasks.length === 0) {
        autoBookTasksList.innerHTML = `
          <div class="py-8 text-center text-slate-400 dark:text-slate-500">
            <i class="fa-solid fa-calendar-xmark text-2xl mb-1.5 block opacity-40"></i>
            <p class="text-xs font-semibold">${isBn() ? 'এখনও কোনো শিডিউল করা অটো-বুক টাস্ক নেই।' : 'No scheduled auto-book tasks yet.'}</p>
            <p class="text-[11px] text-slate-400 mt-0.5">${isBn() ? 'ভবিষ্যৎ তারিখের সকাল ৮:০০ রিলিজের জন্য উপরের ফর্ম ব্যবহার করুন।' : 'Use the scheduler above to set up future date 08:00 AM drops or 24/7 seat grabbers.'}</p>
          </div>
        `;
        if (autoBookClearAllTasksBtn) autoBookClearAllTasksBtn.classList.add('hidden');
        return;
      }

      if (autoBookClearAllTasksBtn) autoBookClearAllTasksBtn.classList.remove('hidden');

      autoBookTasksList.innerHTML = autoBookTasks.map(t => {
        const isPaused = t.status === 'paused';
        const isGrabbed = t.status === 'grabbed';
        const statusBadge = isGrabbed
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">✅ Grabbed</span>`
          : (isPaused
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">⏸ Paused</span>`
            : `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 animate-pulse">⏰ Scheduled</span>`);

        const modeBadge = t.holdOnly
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">🖐️ Hold Only</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">🛒 Buy (OTP)</span>`;

        const displayClasses = Array.isArray(t.targetClasses) && t.targetClasses.length > 0
          ? t.targetClasses.join(', ')
          : (t.seatClass || 'ANY');
        const displayTrains = Array.isArray(t.targetTrains) && t.targetTrains.length > 0
          ? t.targetTrains.join(', ')
          : (t.targetTrain || 'Any Train');

        const activePos = t.positionPref || t.sectionPref || 'any';
        const posMap = {
          'window': 'Window',
          'aisle': 'Aisle',
          'front': 'Front Side',
          'middle': 'Middle',
          'back': 'Back Side'
        };
        const posBadge = (activePos && activePos !== 'any')
          ? ` • <span class="capitalize font-bold text-amber-600 dark:text-amber-400">${posMap[activePos] || activePos}</span>`
          : '';

        return `
          <div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition hover:border-amber-400">
            <div class="space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-black text-slate-900 dark:text-white">${t.fromCity} ➔ ${t.toCity}</span>
                ${statusBadge}
                ${modeBadge}
                <span class="text-[10px] px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 font-bold text-slate-700 dark:text-slate-300">${displayClasses}</span>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                <span><i class="fa-solid fa-calendar mr-1 text-slate-400"></i>${t.journeyDate}</span>
                <span>•</span>
                <span><i class="fa-solid fa-train mr-1 text-slate-400"></i>${displayTrains}</span>
                <span>•</span>
                <span><i class="fa-solid fa-chair mr-1 text-slate-400"></i>${t.count} Seat${t.count > 1 ? 's' : ''} ${t.keepTogether ? '(Together)' : ''}${posBadge}</span>
              </p>
            </div>

            <div class="flex items-center gap-1.5 self-end sm:self-center shrink-0">
              <button type="button" data-action="run" data-id="${t.id}" class="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-2xs transition flex items-center gap-1 cursor-pointer" title="Test Run / Grab Now">
                <i class="fa-solid fa-play text-[10px]"></i>
                <span>Grab Now</span>
              </button>
              <button type="button" data-action="toggle" data-id="${t.id}" class="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer" title="${isPaused ? 'Resume' : 'Pause'}">
                <i class="fa-solid ${isPaused ? 'fa-play text-emerald-500' : 'fa-pause text-amber-500'} text-xs"></i>
              </button>
              <button type="button" data-action="delete" data-id="${t.id}" class="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer" title="Delete Schedule">
                <i class="fa-solid fa-trash-can text-xs"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      autoBookTasksList.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          const taskIdx = autoBookTasks.findIndex(x => x.id === id);
          if (taskIdx === -1) return;

          if (action === 'delete') {
            autoBookTasks.splice(taskIdx, 1);
            saveTasks();
            renderTasks();
            showToast(isBn() ? 'টাস্ক মুছে ফেলা হয়েছে।' : 'Schedule removed.', 'info');
          } else if (action === 'toggle') {
            autoBookTasks[taskIdx].status = autoBookTasks[taskIdx].status === 'paused' ? 'scheduled' : 'paused';
            saveTasks();
            renderTasks();
          } else if (action === 'run') {
            const t = autoBookTasks[taskIdx];
            if (autoBookFromInput) autoBookFromInput.value = t.fromCity;
            if (autoBookToInput) autoBookToInput.value = t.toCity;
            if (autoBookDateInput) autoBookDateInput.value = t.journeyDate;

            // Restore multi-select state
            if (Array.isArray(t.targetClasses) && t.targetClasses.length > 0) {
              selectedAutoBookClasses = [...t.targetClasses];
            } else if (t.seatClass) {
              selectedAutoBookClasses = t.seatClass.split(',').map(s => s.trim()).filter(Boolean);
            } else {
              selectedAutoBookClasses = ['ANY'];
            }
            if (Array.isArray(t.targetTrains) && t.targetTrains.length > 0) {
              selectedAutoBookTrains = [...t.targetTrains];
            } else if (t.targetTrain) {
              selectedAutoBookTrains = t.targetTrain.split(',').map(s => s.trim()).filter(Boolean);
            } else {
              selectedAutoBookTrains = ['ALL'];
            }

            renderAutoBookClasses();
            renderAutoBookTrains(currentAutoBookRouteTrains);

            updateAutoBookSeatCountUI(t.count, false);
            if (autoBookKeepTogetherToggle && t.keepTogether !== undefined) autoBookKeepTogetherToggle.checked = !!t.keepTogether;
            if (autoBookPositionPref) autoBookPositionPref.value = t.positionPref || t.sectionPref || 'any';
            if (t.holdOnly && autoBookModeHold) {
              autoBookModeHold.checked = true;
            } else if (autoBookModeBuy) {
              autoBookModeBuy.checked = true;
            }
            if (t.keepTrying !== undefined && autoBookKeepTryingToggle) {
              autoBookKeepTryingToggle.checked = !!t.keepTrying;
            }
            if (typeof autoDetectModeFromDate === 'function' && t.journeyDate) {
              autoDetectModeFromDate(t.journeyDate);
            } else {
              updateAutoBookActionState();
            }
            autoGrabAttemptCount = 0;
            executeAutoGrabNow();
          }
        });
      });
    }

    if (autoBookClearAllTasksBtn) {
      autoBookClearAllTasksBtn.addEventListener('click', () => {
        autoBookTasks = autoBookTasks.filter(t => t.status !== 'grabbed');
        saveTasks();
        renderTasks();
      });
    }

    renderTasks();

    // 13. Primary Action Button Click
    if (autoBookActionBtn) {
      autoBookActionBtn.addEventListener('click', () => {
        if (isAutoGrabRetrying) {
          stopAutoGrabRetrying(true);
          return;
        }
        if (currentMode === 'now') {
          autoGrabAttemptCount = 0;
          executeAutoGrabNow();
        } else {
          scheduleAutoBookTask();
        }
      });
    }

    // 13b. 1-Tap Headless Mobile Grab Button Click
    if (headlessGrabNowBtn) {
      headlessGrabNowBtn.addEventListener('click', () => {
        executeHeadlessMobileGrabNow();
      });
    }

    // 14. Background Radar Watcher Loop (Auto-grab scheduled tasks when tickets drop)
    let isWatcherRunning = false;
    async function watcherLoop() {
      if (isWatcherRunning) return;
      isWatcherRunning = true;

      try {
        const activeTasks = autoBookTasks.filter(t => t.status === 'scheduled');
        if (activeTasks.length > 0) {
          for (const task of activeTasks) {
            try {
              const trainParam = (task.targetTrain && task.targetTrain !== 'ALL') ? `&train_name=${encodeURIComponent(task.targetTrain)}` : '';
              const res = await fetch(`/api/live-coach-layout?from_city=${encodeURIComponent(task.fromCity)}&to_city=${encodeURIComponent(task.toCity)}&date_of_journey=${encodeURIComponent(task.journeyDate)}&seat_class=${encodeURIComponent(task.seatClass)}${trainParam}`);
              if (res.ok) {
                const json = await res.json();
                if (json && json.data && Array.isArray(json.data.coaches)) {
                  const matchedClass = json.matched_seat_class || (task.seatClass !== 'ANY' ? task.seatClass : null);
                  const classFiltered = matchedClass
                    ? json.data.coaches.filter(c => (c.seat_class || '').toUpperCase() === matchedClass.toUpperCase() && Number(c.available_seats || 0) > 0)
                    : json.data.coaches.filter(c => Number(c.available_seats || 0) > 0);

                  const availableCoaches = classFiltered.length > 0 ? classFiltered : json.data.coaches.filter(c => Number(c.available_seats || 0) > 0);
                  const avail = availableCoaches.reduce((sum, c) => sum + Number(c.available_seats || 0), 0);
                  if (avail >= task.count) {
                    task.status = 'grabbed';
                    saveTasks();
                    renderTasks();

                    const allocation = allocateSmartSeats(json.data.coaches, task.count, {
                      keepTogether: task.keepTogether,
                      positionPref: task.positionPref || task.sectionPref || 'any',
                      preferredClass: matchedClass
                    });
                    if (allocation && allocation.seats.length > 0) {
                      if (task.soundAlarm) playAlarmChime();
                      const coachName = allocation.coach.coach_name || 'Coach';
                      const allocatedClass = allocation.coach.seat_class || matchedClass || 'S_CHAIR';
                      const seatsStr = allocation.seats.map(s => s.seat_number || s.seat_name).join(',');
                      const baseBookingUrl = buildShohozBookingUrl(task.fromCity, task.toCity, task.journeyDate, allocatedClass);
                      const urlObj = new URL(baseBookingUrl);
                      if (json.train_name) urlObj.searchParams.set('train', json.train_name);
                      if (json.train_model) urlObj.searchParams.set('train_model', json.train_model);
                      urlObj.searchParams.set('coach', coachName);
                      urlObj.searchParams.set('seats', seatsStr);
                      urlObj.searchParams.set('seats_count', String(task.count));
                      urlObj.searchParams.set('auto_coach', '1');
                      if (allocation.coach.trip_id) urlObj.searchParams.set('trip_id', allocation.coach.trip_id);
                      if (allocation.coach.trip_route_id) urlObj.searchParams.set('trip_route_id', allocation.coach.trip_route_id);
                      if (task.keepTogether) {
                        urlObj.searchParams.set('keep_together', '1');
                      } else {
                        urlObj.searchParams.set('keep_together', '0');
                      }
                      const activePos = task.positionPref || task.sectionPref || 'any';
                      if (activePos && activePos !== 'any') {
                        urlObj.searchParams.set('position', activePos);
                        if (['front', 'middle', 'back'].includes(activePos)) {
                          urlObj.searchParams.set('section', activePos);
                        }
                      }
                      if (task.holdOnly) {
                        urlObj.searchParams.set('autobook', '1');
                        urlObj.searchParams.set('hold_only', '1');
                      } else if (task.autoProceed) {
                        urlObj.searchParams.set('autobook', '1');
                      }

                      const taskNotice = task.holdOnly
                        ? `⚡ [Radar Seat Hold] Seats found & holding on Railway for ${task.fromCity} ➔ ${task.toCity}!`
                        : `⚡ [Radar Auto-Book] Seats found for ${task.fromCity} ➔ ${task.toCity}! Launching Railway to OTP...`;
                      showToast(taskNotice, 'success');
                      let win = null;
                      try { win = window.open(urlObj.toString(), '_blank'); } catch (e) {}
                      if (!win || win.closed || typeof win.closed === 'undefined') {
                        window.location.href = urlObj.toString();
                      }
                    }
                  }
                }
              }
            } catch (e) {}
          }
        }
      } catch (err) {
      } finally {
        isWatcherRunning = false;
      }
    }

    // High frequency interval around 8:00 AM BD time
    setInterval(() => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const bdNow = new Date(utc + (3600000 * 6));
      const hours = bdNow.getHours();
      const mins = bdNow.getMinutes();

      if ((hours === 7 && mins === 59) || (hours === 8 && mins <= 3)) {
        watcherLoop();
      }
    }, 2000);

    setInterval(watcherLoop, 15000);
  }

  function initPwaServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(async reg => {
          swRegistrationInstance = reg;
          console.log('[PWA] 🚀 Service Worker registered successfully, scope:', reg.scope);
          if ('Notification' in window && Notification.permission === 'granted') {
            subscribeToClosedBrowserPush();
          }
        }).catch(err => {
          console.warn('[PWA] Service Worker registration failed:', err.message);
        });
      });
    }

    // Handle Before Install Prompt
    const pwaMobileInstallBanner = document.getElementById('pwaMobileInstallBanner');
    const pwaMobileInstallBtn = document.getElementById('pwaMobileInstallBtn');
    const pwaMobileDismissBtn = document.getElementById('pwaMobileDismissBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPwaPrompt = e;
      if (pwaInstallBtn) {
        pwaInstallBtn.classList.remove('hidden');
        pwaInstallBtn.classList.add('flex');
      }
      if (pwaMobileInstallBanner && !sessionStorage.getItem('pwa_mobile_banner_dismissed')) {
        pwaMobileInstallBanner.classList.remove('hidden');
        pwaMobileInstallBanner.classList.add('flex');
      }
    });

    const triggerPwaInstall = async () => {
      if (!deferredPwaPrompt) return;
      deferredPwaPrompt.prompt();
      const choiceResult = await deferredPwaPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        console.log('[PWA] User accepted the install prompt');
        if (pwaInstallBtn) {
          pwaInstallBtn.classList.add('hidden');
          pwaInstallBtn.classList.remove('flex');
        }
        if (pwaMobileInstallBanner) {
          pwaMobileInstallBanner.classList.add('hidden');
          pwaMobileInstallBanner.classList.remove('flex');
        }
      }
      deferredPwaPrompt = null;
    };

    if (pwaInstallBtn) {
      pwaInstallBtn.addEventListener('click', triggerPwaInstall);
    }
    if (pwaMobileInstallBtn) {
      pwaMobileInstallBtn.addEventListener('click', triggerPwaInstall);
    }
    if (pwaMobileDismissBtn) {
      pwaMobileDismissBtn.addEventListener('click', () => {
        if (pwaMobileInstallBanner) {
          pwaMobileInstallBanner.classList.add('hidden');
          pwaMobileInstallBanner.classList.remove('flex');
        }
        sessionStorage.setItem('pwa_mobile_banner_dismissed', '1');
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] 📱 App installed successfully');
      if (pwaInstallBtn) {
        pwaInstallBtn.classList.add('hidden');
        pwaInstallBtn.classList.remove('flex');
      }
      if (pwaMobileInstallBanner) {
        pwaMobileInstallBanner.classList.add('hidden');
        pwaMobileInstallBanner.classList.remove('flex');
      }
      showToast('🎉 RailSeat BD installed as an App on your device!', 'success');
    });
  }

  // ----------------------------------------------------
  // Setup Master Event Listeners
  // ----------------------------------------------------
  function setupEventListeners() {
    // 1. Master Delegated Click Listener (Attached immediately)
    document.addEventListener('click', (e) => {
      const seatLayoutBtn = e.target.closest('.view-seat-layout-btn');
      if (seatLayoutBtn) {
        e.preventDefault();
        openSeatLayoutModal({
          trainModel: seatLayoutBtn.dataset.trainModel,
          trainName: seatLayoutBtn.dataset.trainName,
          departureTime: seatLayoutBtn.dataset.departureTime || '',
          tripId: seatLayoutBtn.dataset.tripId,
          tripRouteId: seatLayoutBtn.dataset.tripRouteId,
          seatClass: seatLayoutBtn.dataset.seatClass,
          availableSeats: parseInt(seatLayoutBtn.dataset.availableSeats || '0', 10),
          onlineSeats: parseInt(seatLayoutBtn.dataset.onlineSeats || '0', 10),
          counterSeats: parseInt(seatLayoutBtn.dataset.counterSeats || '0', 10),
          fare: parseFloat(seatLayoutBtn.dataset.fare || '0'),
          fromCity: seatLayoutBtn.dataset.fromCity || state.selectedFrom,
          toCity: seatLayoutBtn.dataset.toCity || state.selectedTo,
          journeyDate: seatLayoutBtn.dataset.journeyDate || state.selectedDate
        });
        return;
      }

      const routeBtn = e.target.closest('.view-route-btn');
      if (routeBtn) {
        openRouteModal(routeBtn.dataset.trainModel, routeBtn.dataset.trainName);
        return;
      }

      const matrixBtn = e.target.closest('.view-station-matrix-btn');
      if (matrixBtn) {
        openStationMatrixModal(matrixBtn.dataset.trainModel, matrixBtn.dataset.trainName);
        return;
      }

      const watchBtn = e.target.closest('.set-watch-btn');
      if (watchBtn) {
        openSetWatchModal({
          train_model: watchBtn.dataset.trainModel,
          train_name: watchBtn.dataset.trainName
        });
        return;
      }
    });

    // 2. Component Initializers with Individual Guard Blocks
    try { updateMonitorUI(state.pollingInterval); } catch (e) { console.warn('[Init] updateMonitorUI:', e.message); }
    try { startMonitorCountdownTicker(); } catch (e) { console.warn('[Init] startMonitorCountdownTicker:', e.message); }
    try { initNotificationCenter(); } catch (e) { console.warn('[Init] initNotificationCenter:', e.message); }
    try { initSettingsMenu(); } catch (e) { console.warn('[Init] initSettingsMenu:', e.message); }
    try { initWatchlist(); } catch (e) { console.warn('[Init] initWatchlist:', e.message); }
    try { initShareModule(); } catch (e) { console.warn('[Init] initShareModule:', e.message); }
    try { initStationMatrixModule(); } catch (e) { console.warn('[Init] initStationMatrixModule:', e.message); }
    try { initSeatLayoutModule(); } catch (e) { console.warn('[Init] initSeatLayoutModule:', e.message); }
    try { initMultiDayMatrixControls(); } catch (e) { console.warn('[Init] initMultiDayMatrixControls:', e.message); }
    try { initLiveTrackerModule(); } catch (e) { console.warn('[Init] initLiveTrackerModule:', e.message); }
    try { initUserManagement(); } catch (e) { console.warn('[Init] initUserManagement:', e.message); }
    try { initPwaServiceWorker(); } catch (e) { console.warn('[Init] initPwaServiceWorker:', e.message); }
    try { initLanguageSwitcher(); } catch (e) { console.warn('[Init] initLanguageSwitcher:', e.message); }
    try { initAnalyticsDashboard(); } catch (e) { console.warn('[Init] initAnalyticsDashboard:', e.message); }
    try { initAutoBookModule(); } catch (e) { console.warn('[Init] initAutoBookModule:', e.message); }
    try { initMobileAutoBookModal(); } catch (e) { console.warn('[Init] initMobileAutoBookModal:', e.message); }
  }

  // ----------------------------------------------------
  // 📱 Mobile Auto-Grab Multi-Option Modal Controller
  // ----------------------------------------------------
  function initMobileAutoBookModal() {
    const modal = document.getElementById('mobileAutoBookModal');
    const openBtns = [
      document.getElementById('openMobileAutoBookSetupBtn'),
      document.getElementById('seatLayoutMobileHelpBtn')
    ].filter(Boolean);
    const closeBtn = document.getElementById('closeMobileAutoBookBtn');
    const dismissBtn = document.getElementById('dismissMobileAutoBookBtn');
    const tabBtns = document.querySelectorAll('.mobile-autobook-tab');
    const copyBookmarkletBtn = document.getElementById('copyAutoBookBookmarkletBtn');
    const bookmarkletTextarea = document.getElementById('mobileAutoBookBookmarkletCode');
    const apiSessionBadge = document.getElementById('mobileApiSessionBadge');

    // 1-Tap Mobile Auto-Grab Bookmarklet Code
    const BOOKMARKLET_CODE = `javascript:(function(){try{if(!location.hostname.includes('eticket.railway.gov.bd')){if(confirm('Please open Bangladesh Railway (eticket.railway.gov.bd) first!\\nOpen now?')){location.href='https://eticket.railway.gov.bd/booking/train/search';}return;}const s=document.createElement('script');s.src='${window.location.origin}/railseat-sync.user.js?t='+Date.now();document.head.appendChild(s);const b=document.createElement('div');b.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#064e3b;color:#fff;padding:10px 18px;border-radius:30px;font-size:12px;font-weight:bold;z-index:9999999;box-shadow:0 6px 20px rgba(0,0,0,0.4);border:1px solid #34d399;font-family:sans-serif;text-align:center;';b.innerHTML='⚡ RailSeat Mobile Auto-Grab Active!';document.body.appendChild(b);setTimeout(()=>b.remove(),4000);}catch(e){alert('RailSeat Error: '+e.message);}})();`;

    if (bookmarkletTextarea) {
      bookmarkletTextarea.value = BOOKMARKLET_CODE;
    }

    const openModal = () => {
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      // Update session badge in Tab 3
      if (apiSessionBadge) {
        if (state.isAuthenticated) {
          apiSessionBadge.className = 'px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
          apiSessionBadge.textContent = 'Active & Connected ✅';
        } else {
          apiSessionBadge.className = 'px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
          apiSessionBadge.textContent = 'Session Not Connected ⚠️';
        }
      }
    };

    const closeModal = () => {
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    };

    openBtns.forEach(btn => btn.addEventListener('click', openModal));
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeModal);

    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Tab Switching
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.mobileTab;
        tabBtns.forEach(b => {
          b.classList.remove('active-mobile-tab', 'border-b-2', 'border-amber-500', 'text-amber-600', 'dark:text-amber-400', 'font-bold');
          b.classList.add('font-semibold', 'text-slate-500', 'dark:text-slate-400');
        });
        btn.classList.add('active-mobile-tab', 'border-b-2', 'border-amber-500', 'text-amber-600', 'dark:text-amber-400', 'font-bold');
        btn.classList.remove('font-semibold', 'text-slate-500', 'dark:text-slate-400');

        document.querySelectorAll('.mobile-tab-pane').forEach(pane => pane.classList.add('hidden'));
        const activePane = document.getElementById(`mobileTabContent-${target}`);
        if (activePane) activePane.classList.remove('hidden');
      });
    });

    // Copy Bookmarklet Script
    if (copyBookmarkletBtn && bookmarkletTextarea) {
      copyBookmarkletBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(bookmarkletTextarea.value);
          const textEl = document.getElementById('copyAutoBookBookmarkletText');
          if (textEl) textEl.textContent = 'Copied! ✅';
          showToast('1-Tap Mobile Bookmarklet copied! Save as bookmark in mobile browser.', 'success');
          setTimeout(() => {
            if (textEl) textEl.textContent = 'Copy Script';
          }, 2500);
        } catch (e) {
          bookmarkletTextarea.select();
          document.execCommand('copy');
          showToast('1-Tap Mobile Bookmarklet copied!', 'success');
        }
      });
    }
  }

  // ----------------------------------------------------
  // 🌐 Internationalization (Bangla / English) Controller
  // ----------------------------------------------------
  function initLanguageSwitcher() {
    // Language toggle buttons
    const langBtns = document.querySelectorAll('.lang-toggle-btn');
    langBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetLang = btn.getAttribute('data-lang');
        if (window.i18n && typeof window.i18n.setLang === 'function') {
          window.i18n.setLang(targetLang);
        }
      });
    });

    // Listen to language switch event across the application
    window.addEventListener('rail_language_changed', (e) => {
      const newLang = e.detail?.lang || 'bn';
      console.log(`[i18n] Language switched to: ${newLang}`);

      // Ensure station inputs stay strictly English canonical
      if (fromStationInput && state.selectedFrom) {
        fromStationInput.value = state.selectedFrom;
      }
      if (toStationInput && state.selectedTo) {
        toStationInput.value = state.selectedTo;
      }

      // Re-generate quick date chips with localized days/months
      generateQuickDateChips();

      // If search results are currently displayed, re-render them localized
      if (state.lastSearchData && Array.isArray(state.lastSearchData)) {
        renderResults(state.lastSearchData);
      }
    });
  }

  // ====================================================
  // 📊 ADMIN ANALYTICS DASHBOARD
  // ====================================================
  function initAnalyticsDashboard() {
    const modal = document.getElementById('analyticsDashboardModal');
    const openBtn = document.getElementById('openAnalyticsDashboardBtn');
    const closeBtn = document.getElementById('analyticsDashboardCloseBtn');
    const refreshBtn = document.getElementById('analyticsRefreshBtn');
    const refreshIcon = document.getElementById('analyticsRefreshIcon');
    const lastUpdatedEl = document.getElementById('analyticsLastUpdated');

    if (!modal || !openBtn) return;

    // Chart.js instances — kept for cleanup on re-render
    const chartInstances = {};

    function isDarkMode() {
      return document.documentElement.classList.contains('dark');
    }

    function chartTextColor() { return isDarkMode() ? '#94a3b8' : '#64748b'; }
    function chartGridColor() { return isDarkMode() ? 'rgba(148,163,184,0.1)' : 'rgba(100,116,139,0.1)'; }

    function destroyChart(id) {
      if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
      }
    }

    function makeLineChart(id, labels, data, color) {
      destroyChart(id);
      const ctx = document.getElementById(id);
      if (!ctx) return;
      chartInstances[id] = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data,
            borderColor: color,
            backgroundColor: color.replace('1)', '0.1)'),
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: chartTextColor(), font: { size: 9 }, maxRotation: 45 }, grid: { color: chartGridColor() } },
            y: { ticks: { color: chartTextColor(), font: { size: 9 }, stepSize: 1 }, grid: { color: chartGridColor() }, beginAtZero: true }
          }
        }
      });
    }

    function makeDoughnutChart(id, labels, data, colors) {
      destroyChart(id);
      const ctx = document.getElementById(id);
      if (!ctx) return;
      chartInstances[id] = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: isDarkMode() ? '#1e293b' : '#f8fafc' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { position: 'bottom', labels: { color: chartTextColor(), font: { size: 9 }, padding: 8, boxWidth: 10 } }
          }
        }
      });
    }

    function renderStatCards(overview) {
      const container = document.getElementById('analyticsStatCards');
      if (!container) return;
      const cards = [
        { icon: 'fa-users', label: 'Total Users', value: overview.totalUsers, color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950/30' },
        { icon: 'fa-circle-check', label: 'Active Users', value: overview.activeUsers, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
        { icon: 'fa-clock', label: 'Pending', value: overview.pendingUsers, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' },
        { icon: 'fa-shield-halved', label: 'Admins', value: overview.adminCount, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30' },
        { icon: 'fa-right-to-bracket', label: 'Total Logins', value: overview.totalLogins, color: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/30' },
        { icon: 'fa-crosshairs', label: 'Radar Alerts', value: overview.totalAlerts, color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/30' }
      ];
      container.innerHTML = cards.map(c => `
        <div class="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col items-center justify-center text-center space-y-1 shadow-xs hover:shadow-md transition">
          <div class="w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center">
            <i class="fa-solid ${c.icon} ${c.color} text-sm"></i>
          </div>
          <p class="font-extrabold text-xl text-slate-900 dark:text-white">${c.value}</p>
          <p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">${c.label}</p>
        </div>
      `).join('');
    }

    function renderTopList(containerId, items, labelKey, countKey, emptyMsg) {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!items || items.length === 0) {
        el.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">${emptyMsg || 'No data yet.'}</p>`;
        return;
      }
      const max = items[0][countKey] || 1;
      el.innerHTML = items.map((item, i) => {
        const pct = Math.round((item[countKey] / max) * 100);
        const rankColors = ['text-amber-500', 'text-slate-500', 'text-orange-400'];
        const rankColor = rankColors[i] || 'text-slate-400';
        return `
          <div class="space-y-0.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-1.5 min-w-0">
                <span class="font-extrabold text-[10px] ${rankColor} w-4 text-center">${i + 1}</span>
                <span class="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">${item[labelKey]}</span>
              </div>
              <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-2 shrink-0">${item[countKey]}</span>
            </div>
            <div class="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden ml-5">
              <div class="h-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style="width:${pct}%"></div>
            </div>
          </div>`;
      }).join('');
    }

    function renderActivityFeed(events) {
      const el = document.getElementById('analyticsActivityFeed');
      if (!el) return;
      if (!events || events.length === 0) {
        el.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">No recent activity.</p>`;
        return;
      }
      const actionConfig = {
        login: { icon: 'fa-right-to-bracket', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30', label: 'Signed in' },
        register: { icon: 'fa-user-plus', color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30', label: 'Registered' }
      };
      el.innerHTML = events.map(ev => {
        const cfg = actionConfig[ev.action] || { icon: 'fa-circle', color: 'text-slate-400 bg-slate-100 dark:bg-slate-800', label: ev.action };
        const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString('en-BD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `
          <div class="flex items-center space-x-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 hover:border-indigo-200 dark:hover:border-indigo-800/50 transition">
            <div class="w-7 h-7 rounded-lg ${cfg.color} flex items-center justify-center shrink-0">
              <i class="fa-solid ${cfg.icon} text-[10px]"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center space-x-1.5">
                <span class="font-bold text-xs text-slate-900 dark:text-white truncate">${ev.name}</span>
                <span class="text-[10px] text-slate-400">@${ev.username}</span>
              </div>
              <p class="text-[10px] text-slate-500 dark:text-slate-400">${cfg.label} · ${ev.device || ''} ${ev.browser ? '· ' + ev.browser.split(' ')[0] : ''}</p>
            </div>
            <span class="text-[10px] text-slate-400 shrink-0">${time}</span>
          </div>`;
      }).join('');
    }

    async function loadAndRenderAnalytics() {
      refreshIcon.classList.add('fa-spin');
      if (lastUpdatedEl) lastUpdatedEl.textContent = 'Loading...';

      try {
        const token = localStorage.getItem('rail_auth_token') || sessionStorage.getItem('rail_auth_token') || '';
        const res = await fetch('/api/admin/analytics', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        // Overview cards
        renderStatCards(data.overview);

        // Line charts
        makeLineChart('chartUserGrowth', data.registrationTimeline.labels, data.registrationTimeline.counts, 'rgba(99,102,241,1)');
        makeLineChart('chartLoginActivity', data.loginActivity.labels, data.loginActivity.counts, 'rgba(16,185,129,1)');

        // Doughnut: Devices
        const devKeys = Object.keys(data.deviceBreakdown);
        const devColors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'];
        makeDoughnutChart('chartDevices', devKeys, devKeys.map(k => data.deviceBreakdown[k]), devColors);

        // Doughnut: Auth Providers
        const authKeys = Object.keys(data.authProviders);
        makeDoughnutChart('chartAuthProvider', authKeys, authKeys.map(k => data.authProviders[k]), ['#6366f1', '#06b6d4']);

        // Doughnut: Radar Alert Types
        const radarTypeKeys = Object.keys(data.radar.alertTypeMap);
        makeDoughnutChart('chartRadarTypes', radarTypeKeys, radarTypeKeys.map(k => data.radar.alertTypeMap[k]), ['#f59e0b', '#ef4444', '#6366f1']);

        // Doughnut: User Status
        const { active, pending, disabled } = data.userStatusBreakdown;
        makeDoughnutChart('chartUserStatus', ['Active', 'Pending', 'Disabled'], [active, pending, disabled], ['#10b981', '#f59e0b', '#ef4444']);

        // Top Lists
        renderTopList('analyticsTopRoutes', data.radar.topRoutes, 'route', 'count', 'No radar alerts yet.');
        renderTopList('analyticsTopTrains', data.radar.topTrains, 'train', 'count', 'No train alerts yet.');
        renderTopList('analyticsTopClasses', data.radar.topClasses, 'cls', 'count', 'No class alerts yet.');

        // Activity Feed
        renderActivityFeed(data.recentActivity);

        // Update timestamp
        if (lastUpdatedEl) {
          const ts = new Date(data.generatedAt).toLocaleString('en-BD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          lastUpdatedEl.textContent = `Last updated: ${ts}`;
        }
      } catch (err) {
        if (lastUpdatedEl) lastUpdatedEl.textContent = 'Failed to load analytics.';
        console.error('[Analytics] Load error:', err.message);
      } finally {
        refreshIcon.classList.remove('fa-spin');
      }
    }

    openBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
      loadAndRenderAnalytics();
    });

    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      Object.keys(chartInstances).forEach(id => destroyChart(id));
    });

    refreshBtn.addEventListener('click', () => {
      loadAndRenderAnalytics();
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        Object.keys(chartInstances).forEach(id => destroyChart(id));
      }
    });
  }

});
