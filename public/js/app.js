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

  // Live Tracker DOM Elements
  const seatFinderSection = document.getElementById('seatFinderSection');
  const liveTrackerSection = document.getElementById('liveTrackerSection');
  const navSeatFinderBtn = document.getElementById('navSeatFinderBtn');
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
  const authModalOpenBtn = document.getElementById('authModalOpenBtn');
  const authModalCloseBtn = document.getElementById('authModalCloseBtn');
  const authBtnIcon = document.getElementById('authBtnIcon');
  const authBtnText = document.getElementById('authBtnText');
  const statusDot = document.getElementById('statusDot');
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

  const mobileBookmarkletSnippet = document.getElementById('mobileBookmarkletSnippet');
  const copyMobileSnippetBtn = document.getElementById('copyMobileSnippetBtn');
  const mobilePasteForm = document.getElementById('mobilePasteForm');
  const mobilePasteInput = document.getElementById('mobilePasteInput');
  
  const tokenPasteInput = document.getElementById('tokenPasteInput');
  const deviceIdInput = document.getElementById('deviceIdInput');
  const deviceKeyInput = document.getElementById('deviceKeyInput');

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
    const chosenClass = preferredClass && preferredClass !== 'ALL' ? preferredClass : 'S_CHAIR';

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
      const res = await fetch('/api/auth/status', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      updateAuthUI(data.authenticated, data.user, data.token_preview, data.device_id, data.device_key, data.has_saved_session);
    } catch (err) {
      console.warn('Could not check auth status:', err);
    }
  }

  function updateAuthUI(isAuth, user, tokenPreview, deviceId, deviceKey, isSaved = false) {
    state.isAuthenticated = isAuth;
    state.authUserData = user;

    if (deviceId && deviceIdInput) deviceIdInput.value = deviceId;
    if (deviceKey && deviceKeyInput) deviceKeyInput.value = deviceKey;

    if (isAuth) {
      authModalOpenBtn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white';
      authBtnIcon.className = 'fa-solid fa-circle-check text-[11px]';
      const displayName = user?.name ? user.name.split(' ')[0] : 'Live';
      authBtnText.textContent = `🚆 ${displayName}`;
      
      liveBadge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-800';
      liveBadge.textContent = '🟢 100% Live API';
      searchModeBadge.textContent = 'Shohoz Live API';

      if (modalAuthStatusCard) modalAuthStatusCard.classList.add('hidden');
      if (modalRailwayProfileCard) {
        modalRailwayProfileCard.classList.remove('hidden');
        if (railProfileName) railProfileName.textContent = user?.name || 'Railway Passenger';
        if (railProfilePhone) railProfilePhone.textContent = user?.phone || user?.mobile_number || '---';
        if (railProfileEmail) railProfileEmail.textContent = user?.email || '---';
        if (railProfileNid) railProfileNid.textContent = user?.nid ? `${user.nid} (${user.nidType || 'NID'})` : '---';
        if (railProfileExpires) {
          railProfileExpires.textContent = user?.expiresAt 
            ? 'Session valid until ' + new Date(user.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Active Live Session';
        }
      }

      noticeBanner.classList.add('hidden');
    } else {
      authModalOpenBtn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white';
      authBtnIcon.className = 'fa-solid fa-key text-[11px]';
      authBtnText.textContent = 'Connect Live API';
      
      liveBadge.className = 'text-xs px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold border border-amber-300 dark:border-amber-800';
      liveBadge.textContent = '⚡ Connect Session';
      searchModeBadge.textContent = 'Session Required';

      if (modalRailwayProfileCard) modalRailwayProfileCard.classList.add('hidden');
      if (modalAuthStatusCard) modalAuthStatusCard.classList.remove('hidden');

      noticeBanner.className = 'p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60 animate-fade-in';
      noticeText.textContent = 'Click "Connect Live API" to sync your Bangladesh Railway session. Your session will be automatically saved for future visits.';
      bannerConnectBtn.classList.remove('hidden');
      noticeBanner.classList.remove('hidden');
    }
  }

  // Modal Open / Close
  authModalOpenBtn.addEventListener('click', () => authModal.classList.remove('hidden'));
  bannerConnectBtn.addEventListener('click', () => authModal.classList.remove('hidden'));
  authModalCloseBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) authModal.classList.add('hidden');
  });

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
      if (mobileLoginTab) mobileLoginTab.classList.remove('hidden');
    });
  }

  // Copy Snippet Button (PC)
  if (copySnippetBtn && consoleSnippet) {
    copySnippetBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(consoleSnippet.value);
      copySnippetBtn.textContent = 'Copied!';
      setTimeout(() => copySnippetBtn.textContent = 'Copy', 2000);
      showToast('Script copied! Paste into eticket.railway.gov.bd Console.', 'info');
    });
  }

  // Copy Mobile Bookmarklet Snippet Button
  if (copyMobileSnippetBtn && mobileBookmarkletSnippet) {
    copyMobileSnippetBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(mobileBookmarkletSnippet.value);
      copyMobileSnippetBtn.textContent = 'Copied!';
      setTimeout(() => copyMobileSnippetBtn.textContent = 'Copy', 2000);
      showToast('Mobile bookmark script copied! Paste as bookmark URL.', 'info');
    });
  }

  // Helper to Parse & Activate JSON / Token / cURL
  async function handleTokenActivation(rawString) {
    const raw = (rawString || '').trim();
    if (!raw) return;

    let token = '';
    let deviceId = '';
    let deviceKey = '';

    // Check if pasted cURL command from DevTools
    if (raw.toLowerCase().includes('curl') || raw.includes('authorization:') || raw.includes('Authorization:') || raw.includes('x-device-id')) {
      const authMatch = raw.match(/[-H\s]['"]?[Aa]uthorization:\s*(Bearer\s+)?([^'"\r\n]+)['"]?/i);
      const deviceIdMatch = raw.match(/[-H\s]['"]?x-device-id:\s*([^'"\r\n]+)['"]?/i);
      const deviceKeyMatch = raw.match(/[-H\s]['"]?x-device-key:\s*([^'"\r\n]+)['"]?/i);

      if (authMatch) token = authMatch[2].trim();
      if (deviceIdMatch) deviceId = deviceIdMatch[1].trim();
      if (deviceKeyMatch) deviceKey = deviceKeyMatch[1].trim();

      await saveCredentials({ token, device_id: deviceId, device_key: deviceKey, raw_curl: raw });
      return;
    }

    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw);
        token = parsed.token || parsed.authToken || parsed.access_token || parsed.accessToken || '';
        deviceId = parsed['x-device-id'] || parsed.deviceId || parsed.device_id || parsed.device_uuid || '';
        deviceKey = parsed['x-device-key'] || parsed.deviceKey || parsed.device_key || parsed.sdkKey || parsed.ssdk || parsed.SSDK || '';
      } catch (err) {
        token = raw;
      }
    } else {
      token = raw;
    }

    await saveCredentials({ token, device_id: deviceId, device_key: deviceKey, raw_curl: raw });
  }

  // Tab 1: PC Script Paste Form Handler
  if (scriptPasteForm) {
    scriptPasteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleTokenActivation(scriptPasteInput.value);
    });
  }

  // Tab 2: Mobile Paste Form Handler
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
      const deviceKey = deviceKeyInput.value.trim();

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
        showToast('Live Railway session saved permanently and activated!', 'success');
        updateAuthUI(true, data.user, data.token_preview, data.device_id, data.device_key, true);
        authModal.classList.add('hidden');
        scriptPasteInput.value = '';
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
  disconnectTokenBtn.addEventListener('click', async () => {
    try {
      const token = getAuthToken();
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      updateAuthUI(false, null, null, null, null, false);
      showToast('Disconnected. Saved session deleted.', 'info');
      trainsGrid.innerHTML = '';
      trainsTableView.classList.add('hidden');
      initialStateCard.classList.remove('hidden');
      statsRibbon.classList.add('hidden');
      trackerBar.classList.add('hidden');
    } catch (err) {
      console.warn('Logout error:', err);
    }
  });

  // ----------------------------------------------------
  // Dynamic Route Train Options Manager
  // ----------------------------------------------------
  function populateTrainFilterOptions(trainList) {
    const currentVal = trainFilterSelect.value;
    trainFilterSelect.innerHTML = '<option value="ALL">All Trains (Default)</option>';

    const uniqueTrains = new Map();
    trainList.forEach(t => {
      const name = t.train_name || t.name;
      const code = t.train_model || t.code || '';
      if (name && !uniqueTrains.has(name)) {
        uniqueTrains.set(name, code);
      }
    });

    uniqueTrains.forEach((code, name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = code ? `${name} (#${code})` : name;
      trainFilterSelect.appendChild(opt);
    });

    if (uniqueTrains.has(currentVal)) {
      trainFilterSelect.value = currentVal;
      state.selectedTrain = currentVal;
    } else {
      trainFilterSelect.value = 'ALL';
      state.selectedTrain = 'ALL';
    }
  }

  trainFilterSelect.addEventListener('change', (e) => {
    state.selectedTrain = e.target.value;
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
      if (notifCenterContainer && !notifCenterContainer.contains(e.target) && !notifDropdown.contains(e.target)) {
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
      const timeStr = formatRelativeTime(item.timestamp);
      const isRadarHit = item.type === 'RADAR_TARGET_HIT';
      const isSoldOutReleased = item.type === 'SOLD_OUT_RELEASED';

      return `
        <div class="p-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-start space-x-2.5 ${
          item.isRead 
            ? 'opacity-90' 
            : isSoldOutReleased
              ? 'bg-rose-50/80 dark:bg-rose-950/40 border-l-4 border-rose-500 shadow-xs ring-1 ring-rose-300/40'
              : isRadarHit 
                ? 'bg-amber-50/70 dark:bg-amber-950/40 border-l-4 border-amber-500 shadow-2xs' 
                : 'bg-emerald-50/50 dark:bg-emerald-950/30 border-l-2 border-emerald-500'
        }">
          <div class="w-8 h-8 rounded-xl ${
            isSoldOutReleased
              ? 'bg-gradient-to-tr from-rose-600 via-red-500 to-amber-500 text-white shadow-sm'
              : isRadarHit 
                ? 'bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 text-white shadow-xs' 
                : 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-2xs'
          } flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
            <i class="fa-solid ${isSoldOutReleased ? 'fa-bolt animate-pulse' : (isRadarHit ? 'fa-crosshairs' : 'fa-bell')} text-xs"></i>
          </div>

          <div class="flex-1 min-w-0 space-y-1.5">
            <!-- Header with Title, Seats & Time -->
            <div class="flex items-center justify-between gap-1">
              <div class="flex items-center space-x-1.5">
                <span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded ${
                  isSoldOutReleased
                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-700/80 font-mono font-bold'
                    : isRadarHit 
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 font-mono' 
                      : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                }">${isSoldOutReleased ? '🚨 RELEASED!' : (isRadarHit ? '🎯 Radar Target' : '🟢 Seat Alert')}</span>
                <span class="text-[10px] text-slate-400 font-mono">${timeStr}</span>
              </div>
              ${item.seats ? `<span class="text-[11px] font-black ${
                isSoldOutReleased
                  ? 'text-rose-900 dark:text-rose-200 bg-rose-100 dark:bg-rose-950/90 border border-rose-300 dark:border-rose-700'
                  : isRadarHit 
                    ? 'text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/90 border border-amber-300 dark:border-amber-700' 
                    : 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/90 border border-emerald-300 dark:border-emerald-700/60'
              } px-2 py-0.5 rounded-full shadow-2xs">${item.seats} Available</span>` : ''}
            </div>

            <!-- Focused Highlights: Train Name & Seat Class -->
            <div class="flex items-center flex-wrap gap-1.5 py-0.5">
              <!-- Train Name Highlight Badge -->
              <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg ${isSoldOutReleased ? 'bg-rose-950 text-rose-100 border border-rose-700/60' : (isRadarHit ? 'bg-amber-950 text-amber-100 border border-amber-700/60' : 'bg-slate-900 dark:bg-slate-800 text-white')} text-xs font-black shadow-xs">
                <i class="fa-solid fa-train text-[10px] ${isSoldOutReleased ? 'text-amber-300' : (isRadarHit ? 'text-amber-400' : 'text-emerald-400')}"></i>
                <span>${item.trainName || 'Intercity Train'}</span>
                ${item.trainModel ? `<span class="text-slate-400 font-mono text-[10px]">#${item.trainModel}</span>` : ''}
              </span>

              <!-- Seat Class Highlight Badge -->
              <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg ${isSoldOutReleased ? 'bg-rose-100 dark:bg-rose-950 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-700' : 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80'} font-black text-xs shadow-2xs">
                <i class="fa-solid fa-couch text-[9px] ${isSoldOutReleased ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}"></i>
                <span>${item.className || 'Seat Class'}</span>
              </span>
            </div>

            <!-- Route Info & Book Button -->
            <div class="flex items-center justify-between pt-0.5">
              <span class="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                ${item.fromCity && item.toCity ? `${item.fromCity} ➔ ${item.toCity} &bull; ${item.date}` : item.date}
              </span>
              ${item.bookUrl && item.bookUrl !== '#' ? `
                <a href="${item.bookUrl}" target="_blank" rel="noopener" class="px-2.5 py-1 rounded-lg ${
                  isSoldOutReleased
                    ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 ring-1 ring-rose-400'
                    : isRadarHit 
                      ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700' 
                      : 'bg-emerald-600 hover:bg-emerald-700'
                } text-white font-black text-[10px] shadow-xs inline-flex items-center space-x-1 transition hover:scale-105">
                  <span>Book</span>
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
  // Toast Notifications (Normal, Sold Out -> Available, & Radar Hit)
  // ----------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-600 text-white',
      error: 'bg-rose-600 text-white',
      info: 'bg-slate-800 text-white dark:bg-slate-700'
    };
    const icons = {
      success: 'fa-circle-check',
      error: 'fa-triangle-exclamation',
      info: 'fa-circle-info'
    };

    toast.className = `flex items-center space-x-2.5 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold ${bgColors[type] || bgColors.info} animate-fade-in pointer-events-auto`;
    toast.innerHTML = `
      <i class="fa-solid ${icons[type] || icons.info} text-sm"></i>
      <span>${message}</span>
    `;

    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 5500);
  }

  // 🚨 Specialized Sold Out -> Available Toast
  function showSoldOutReleasedToast(trainName, className, seats, bookUrl) {
    const toast = document.createElement('div');
    toast.className = 'flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl shadow-2xl bg-gradient-to-r from-rose-600 via-amber-600 to-emerald-600 text-white text-xs font-bold ring-2 ring-rose-400 dark:ring-rose-500 animate-fade-in pointer-events-auto border border-amber-200/50';
    toast.innerHTML = `
      <div class="flex items-center space-x-2.5 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-black/25 flex items-center justify-center text-sm shadow-xs shrink-0 animate-bounce">
          <i class="fa-solid fa-bolt text-amber-300 text-sm"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center space-x-1.5">
            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-950/90 text-amber-200 border border-rose-400/60 font-mono">🚨 RELEASED!</span>
            <span class="font-extrabold text-white truncate">${trainName}</span>
          </div>
          <p class="text-[11px] text-amber-100 font-medium truncate mt-0.5">
            <span class="font-black text-white underline">${seats} seat(s)</span> released in <span class="font-black text-amber-200">${className}</span>!
          </p>
        </div>
      </div>
      ${bookUrl && bookUrl !== '#' ? `
        <a href="${bookUrl}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-white text-rose-950 hover:bg-rose-100 font-black text-xs shadow-md transition shrink-0 inline-flex items-center space-x-1 hover:scale-105">
          <span>Book</span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[9px] text-rose-700"></i>
        </a>
      ` : ''}
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 7500);
  }

  // 🎯 Specialized Watchlist Radar Hit Toast
  function showRadarHitToast(trainName, className, seats, bookUrl) {
    const toast = document.createElement('div');
    toast.className = 'flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl shadow-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white text-xs font-bold ring-2 ring-amber-300 dark:ring-amber-400 animate-fade-in pointer-events-auto border border-amber-200/40';
    toast.innerHTML = `
      <div class="flex items-center space-x-2.5 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center text-sm shadow-xs shrink-0">
          <i class="fa-solid fa-crosshairs animate-spin text-amber-200 text-sm"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center space-x-1.5">
            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-950/70 text-amber-200 border border-amber-400/40">Radar Target Hit</span>
            <span class="font-extrabold text-white truncate">${trainName}</span>
          </div>
          <p class="text-[11px] text-amber-100 font-medium truncate mt-0.5">
            <span class="font-black text-white underline">${seats} seat(s)</span> available in <span class="font-black text-amber-200">${className}</span>!
          </p>
        </div>
      </div>
      ${bookUrl && bookUrl !== '#' ? `
        <a href="${bookUrl}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-white text-amber-950 hover:bg-amber-100 font-black text-xs shadow-md transition shrink-0 inline-flex items-center space-x-1 hover:scale-105">
          <span>Book</span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[9px] text-amber-700"></i>
        </a>
      ` : ''}
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 7000);
  }

  // ----------------------------------------------------
  // Date Picker & Quick Day Shortcuts
  // ----------------------------------------------------
  function setupDateLimits() {
    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 10);

    const todayFormatted = today.toISOString().split('T')[0];
    const maxDateFormatted = maxDate.toISOString().split('T')[0];

    journeyDateInput.min = todayFormatted;
    journeyDateInput.max = maxDateFormatted;
    journeyDateInput.value = todayFormatted;
    state.selectedDate = todayFormatted;
  }

  function generateQuickDateChips() {
    dateChipsContainer.querySelectorAll('.date-chip').forEach(c => c.remove());
    const today = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const label = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : `${days[d.getDay()]} (${d.getDate()} ${months[d.getMonth()]})`);

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `date-chip px-2 py-0.5 rounded text-xs font-medium transition ${
        i === 0 
          ? 'bg-emerald-600 text-white' 
          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
      }`;
      chip.textContent = label;
      chip.dataset.date = iso;

      chip.addEventListener('click', () => {
        journeyDateInput.value = iso;
        state.selectedDate = iso;
        updateActiveDateChips(iso);
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
        chip.className = 'date-chip px-2 py-0.5 rounded text-xs font-medium bg-emerald-600 text-white transition';
      } else {
        chip.className = 'date-chip px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition';
      }
    });
  }

  journeyDateInput.addEventListener('change', (e) => {
    state.selectedDate = e.target.value;
    updateActiveDateChips(e.target.value);
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

      const otherMatches = state.stations.filter(s => 
        s.name.toLowerCase().includes(query) ||
        (s.display_name && s.display_name.toLowerCase().includes(query)) ||
        (s.bn_name && s.bn_name.includes(query)) ||
        (s.alias && s.alias.toLowerCase().includes(query))
      );

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
    if (items.length === 0) {
      dropdownEl.innerHTML = `
        <div class="px-4 py-3 text-xs text-slate-400 text-center">
          No matching Shohoz station found
        </div>
      `;
      dropdownEl.classList.remove('hidden');
      return;
    }

    dropdownEl.innerHTML = items.map(s => `
      <div class="autocomplete-item px-3.5 py-2.5 cursor-pointer flex items-center justify-between text-xs transition" data-name="${s.name}">
        <div class="flex items-center space-x-2">
          <i class="fa-solid fa-train text-emerald-500 text-[10px]"></i>
          <span class="font-semibold text-slate-800 dark:text-slate-100">${s.display_name || s.name}</span>
          ${s.bn_name ? `<span class="text-slate-400 font-bengali">(${s.bn_name})</span>` : ''}
        </div>
        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-semibold">${s.name}</span>
      </div>
    `).join('');

    dropdownEl.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        inputEl.value = name;
        dropdownEl.classList.add('hidden');
        onSelect(name);
      });
    });

    dropdownEl.classList.remove('hidden');
  }

  setupAutocomplete(fromStationInput, fromDropdown, clearFromBtn, (name) => {
    state.selectedFrom = name;
  });

  setupAutocomplete(toStationInput, toDropdown, clearToBtn, (name) => {
    state.selectedTo = name;
  });

  swapStationsBtn.addEventListener('click', () => {
    const tempVal = fromStationInput.value;
    fromStationInput.value = toStationInput.value;
    toStationInput.value = tempVal;

    state.selectedFrom = fromStationInput.value;
    state.selectedTo = toStationInput.value;

    clearFromBtn.classList.toggle('hidden', !fromStationInput.value);
    clearToBtn.classList.toggle('hidden', !toStationInput.value);
    swapIcon.classList.toggle('rotate-180');

    if (state.selectedFrom && state.selectedTo) {
      executeSearch();
    }
  });

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
        ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-700';

      return `
        <button type="button" class="quick-route-chip px-2.5 py-1 rounded-xl font-bold border-2 transition cursor-pointer shrink-0 ${activeClass}" 
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
    state.selectedDate = journeyDateInput.value;

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
      state.selectedDate = journeyDateInput.value;

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
    }

    try {
      const token = getAuthToken();
      const url = `/api/search?from_city=${encodeURIComponent(state.selectedFrom)}&to_city=${encodeURIComponent(state.selectedTo)}&date_of_journey=${encodeURIComponent(state.selectedDate)}&check_alternates=${checkAlternates ? 'true' : 'false'}`;
      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();

      loadingIndicator.classList.add('hidden');
      searchSubmitBtn.disabled = false;
      searchSubmitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass text-xs"></i><span class="whitespace-nowrap">Find Trains</span>';
      if (deepSearchSubmitBtn) {
        deepSearchSubmitBtn.disabled = false;
        deepSearchSubmitBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-300 text-xs"></i><span class="whitespace-nowrap">Deep Search</span>';
      }
      state.isLoading = false;

      // Handle Session Expiration / Authentication Failure
      if (data.session_expired || data.auth_error || data.auth_required) {
        updateAuthUI(false, null, null, null, null, false);
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

      // Populate train filter options from live trains
      if (data.trains && data.trains.length > 0) {
        populateTrainFilterOptions(data.trains);
      }

      detectSeatChanges(data.trains);
      state.lastSearchData = data;
      renderResults(data, checkAlternates, isSilent);
      updateTrackerBar(data);

    } catch (err) {
      console.error('Live search error:', err);
      loadingIndicator.classList.add('hidden');
      searchSubmitBtn.disabled = false;
      searchSubmitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass text-xs"></i><span class="whitespace-nowrap">Find Trains</span>';
      if (deepSearchSubmitBtn) {
        deepSearchSubmitBtn.disabled = false;
        deepSearchSubmitBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-300 text-xs"></i><span class="whitespace-nowrap">Deep Search</span>';
      }
      state.isLoading = false;
      showToast('Network error while querying live Bangladesh Railway servers.', 'error');
    }
  }

  function detectSeatChanges(currentTrains) {
    let soldOutReleasedFound = false;
    let normalSeatFound = false;
    let releasedTrainInfo = null;

    const dojParam = formatShohozDoj(state.selectedDate);

    currentTrains.forEach(train => {
      (train.seat_types || []).forEach(st => {
        const key = `${train.train_name}_${st.type}`;
        const prev = state.previousSeatCounts.get(key);
        const curr = Number(st.seats_available || 0) + Number(st.counter_seats_available || 0);

        // CASE 1: Previously ALL SOLD OUT (0 seats) and now has seats (>0) -> URGENT RELEASED SEAT!
        if (prev !== undefined && prev === 0 && curr > 0) {
          soldOutReleasedFound = true;
          const chosenClass = st.type || 'S_CHAIR';
          const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);

          releasedTrainInfo = {
            trainName: train.train_name,
            trainModel: train.train_model,
            className: st.display_name || st.type,
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
              trainName: train.train_name,
              trainModel: train.train_model,
              className: st.display_name || st.type,
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
        if (!target.active) return;
        const trainMatch = currentTrains.find(t => 
          (t.train_name && t.train_name.toLowerCase().trim() === target.trainName.toLowerCase().trim()) ||
          (t.train_model && target.trainModel && String(t.train_model) === String(target.trainModel))
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
    const trains = data.trains || [];

    // Filter by Train if selected
    let filteredTrains = trains;
    if (state.selectedTrain && state.selectedTrain !== 'ALL') {
      filteredTrains = filteredTrains.filter(t => 
        t.train_name.toLowerCase().trim() === state.selectedTrain.toLowerCase().trim()
      );
    }

    // Filter by Class if selected
    if (state.selectedClass && state.selectedClass !== 'ALL') {
      filteredTrains = filteredTrains.filter(t => 
        (t.seat_types || []).some(s => s.type.toUpperCase() === state.selectedClass.toUpperCase())
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

    // Filter out any connection where Leg 2 start time is before Leg 1 arrival/departure
    const validRoutes = alternateRoutes.filter(alt => {
      if (alt.is_same_train) return true;
      const t1Arr = parseTimeToMinutes(alt.leg1?.arrival_time) || parseTimeToMinutes(alt.leg1?.departure_time);
      const t2Dep = parseTimeToMinutes(alt.leg2?.departure_time);
      if (t1Arr !== null && t2Dep !== null) {
        return t2Dep > t1Arr; // Train 2 MUST depart AFTER Train 1 arrives
      }
      return true;
    });

    if (validRoutes.length === 0) {
      alternateRoutesContainer.classList.add('hidden');
      alternateRoutesContainer.innerHTML = '';
      return;
    }

    const sameTrainCount = validRoutes.filter(r => r.is_same_train).length;

    alternateRoutesContainer.classList.remove('hidden');
    alternateRoutesContainer.innerHTML = `
      <div class="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-indigo-950/40 border-2 border-emerald-500/40 space-y-3 shadow-md animate-fade-in">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
              <i class="fa-solid fa-route"></i>
            </div>
            <div>
              <h4 class="font-black text-sm text-white flex items-center space-x-2">
                <span>⚡ Smart Alternate Stoppage & Junction Split Routes</span>
                <span class="px-2 py-0.2 rounded-full text-[10px] bg-emerald-500 text-slate-950 font-black">${validRoutes.length} Found</span>
              </h4>
              <p class="text-[11px] text-emerald-200/80">Direct end-to-end seats are sold out. Book via <b>Same-Train Quota</b> or ride the <b>Longest Available Leg</b> and transfer to the next connecting train!</p>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-0.5">
          ${validRoutes.map((alt, idx) => {
            const leg1Book = buildShohozBookingUrl(alt.leg1.from, alt.leg1.to, state.selectedDate, 'ALL');
            const leg2Book = buildShohozBookingUrl(alt.leg2.from, alt.leg2.to, state.selectedDate, 'ALL');
            const isSameTrain = !!alt.is_same_train;
            const layoverStr = alt.layover_text || 'Transfer';

            return `
              <div class="p-3.5 rounded-2xl bg-slate-900/95 border-2 ${isSameTrain ? 'border-emerald-500/60 shadow-md' : 'border-indigo-500/50 shadow-sm'} space-y-2.5 text-xs relative overflow-hidden">
                
                <!-- Option Header -->
                <div class="flex items-center justify-between border-b-2 border-slate-800 pb-2 flex-wrap gap-1">
                  <div class="flex items-center space-x-1.5 min-w-0">
                    <span class="font-extrabold text-white text-xs sm:text-sm truncate">
                      ${isSameTrain ? alt.train_name : `Option ${idx + 1}: ${alt.leg1.train_name} ➔ ${alt.leg2.train_name}`}
                    </span>
                    ${isSameTrain ? `<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono font-bold border border-slate-700">#${alt.train_model}</span>` : ''}
                  </div>
                  
                  <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[10px] font-black shrink-0 ${isSameTrain ? 'bg-emerald-500/20 text-emerald-300 border-2 border-emerald-500/50' : 'bg-indigo-500/20 text-indigo-300 border-2 border-indigo-500/50'}">
                    <i class="fa-solid ${isSameTrain ? 'fa-train-circle-check text-emerald-400' : 'fa-train-subway text-indigo-400'} text-[9px]"></i>
                    <span>${isSameTrain ? `SAME TRAIN (Via ${alt.via_hub})` : `🚀 Longest Ride + Next Train`}</span>
                  </span>
                </div>

                ${isSameTrain ? `
                  <div class="text-[11px] text-emerald-300/95 bg-emerald-950/60 px-2.5 py-1.5 rounded-xl border-2 border-emerald-800/40 flex items-center space-x-1.5 font-medium">
                    <i class="fa-solid fa-circle-info text-xs text-emerald-400 shrink-0"></i>
                    <span>No train change needed! Board <b>${alt.train_name}</b> and remain onboard for the entire journey.</span>
                  </div>
                ` : `
                  <div class="text-[11px] text-indigo-200 bg-indigo-950/60 px-2.5 py-1.5 rounded-xl border-2 border-indigo-800/40 flex items-center space-x-1.5 font-medium">
                    <i class="fa-solid fa-shuffle text-xs text-indigo-400 shrink-0"></i>
                    <span>Ride <b>${alt.leg1.train_name}</b> to ${alt.via_hub}, then switch to <b>${alt.leg2.train_name}</b> (⏱️ ${layoverStr} transfer wait).</span>
                  </div>
                `}
                
                <!-- Leg 1 Breakdown (Longest First Leg) -->
                <div class="space-y-1 bg-slate-800/60 p-2.5 rounded-xl border-2 border-slate-700/80">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-extrabold text-slate-100">Leg 1: ${alt.leg1.from} ➔ ${alt.leg1.to}</span>
                    <span class="text-[10px] font-black text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-700/60 font-mono">🟢 ${alt.leg1.seats} Seats</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                    <span>${alt.leg1.train_name} (${alt.leg1.departure_time || ''} - ${alt.leg1.arrival_time || ''})</span>
                    <a href="${leg1Book}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 font-extrabold flex items-center space-x-1">
                      <span>Book Leg 1</span>
                      <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                    </a>
                  </div>
                </div>

                <!-- Transfer Connector Bar (If switching trains) -->
                ${!isSameTrain ? `
                  <div class="flex items-center justify-center space-x-2 py-0.5 text-[10px] font-bold text-amber-300">
                    <i class="fa-solid fa-arrow-down text-[9px]"></i>
                    <span>Transfer at ${alt.via_hub} (Layover: ${layoverStr})</span>
                    <i class="fa-solid fa-arrow-down text-[9px]"></i>
                  </div>
                ` : ''}

                <!-- Leg 2 Breakdown (Next Train Connection) -->
                <div class="space-y-1 bg-slate-800/60 p-2.5 rounded-xl border-2 border-slate-700/80">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-extrabold text-slate-100">Leg 2: ${alt.leg2.from} ➔ ${alt.leg2.to}</span>
                    <span class="text-[10px] font-black text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-700/60 font-mono">🟢 ${alt.leg2.seats} Seats</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                    <span>${alt.leg2.train_name} (${alt.leg2.departure_time || ''} - ${alt.leg2.arrival_time || ''})</span>
                    <a href="${leg2Book}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 font-extrabold flex items-center space-x-1">
                      <span>Book Leg 2</span>
                      <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                    </a>
                  </div>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
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
  // Compact & Modern Train Card Grid View Renderer
  // ----------------------------------------------------
  function renderGridView(trains) {
    const dojParam = formatShohozDoj(state.selectedDate);

    trainsGrid.innerHTML = trains.map(train => {
      const grandTotal = (train.seat_types || []).reduce((sum, s) => {
        return sum + Number(s.seats_available || 0) + Number(s.counter_seats_available || 0);
      }, 0);

      const hasAnySeats = grandTotal > 0;
      const availClasses = (train.seat_types || []).filter(s => (Number(s.seats_available || 0) + Number(s.counter_seats_available || 0)) > 0);
      const chosenClass = state.selectedClass !== 'ALL' ? state.selectedClass : (availClasses.length > 0 ? availClasses[0].type : (train.seat_types?.[0]?.type || 'S_CHAIR'));
      const bookUrl = buildShohozBookingUrl(state.selectedFrom, state.selectedTo, state.selectedDate, chosenClass);

      return `
        <div class="travel-card bg-white dark:bg-slate-900 rounded-2xl p-3.5 sm:p-4 border-2 border-slate-300 dark:border-slate-700/90 shadow-sm transition space-y-3">
          
          <!-- TOP HEADER: Train Identity & Timetable Ribbon -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b-2 border-slate-100 dark:border-slate-800">
            
            <!-- Train Identity -->
            <div class="flex items-center space-x-2.5 min-w-0">
              <div class="w-8 h-8 rounded-xl ${hasAnySeats ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-300 dark:border-slate-700'} flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                <i class="fa-solid fa-train"></i>
              </div>
              <div class="min-w-0">
                <div class="flex items-center space-x-1.5 flex-wrap">
                  <h3 class="text-sm sm:text-base font-black text-slate-900 dark:text-white tracking-tight truncate">${train.train_name}</h3>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold border border-slate-300 dark:border-slate-700">#${train.train_model}</span>
                </div>
                <p class="text-[11px] text-slate-400">
                  Off: <span class="font-bold text-slate-600 dark:text-slate-300">${train.off_day || 'None'}</span>
                </p>
              </div>
            </div>

            <!-- Route Timings (Departure ➔ Duration ➔ Arrival) -->
            <div class="flex items-center justify-between sm:justify-end space-x-3 bg-slate-50/90 dark:bg-slate-800/70 px-3 py-1.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-xs self-start sm:self-auto">
              <div class="text-left">
                <div class="font-black text-slate-900 dark:text-white text-xs sm:text-sm">${train.departure_time}</div>
                <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[90px] font-medium">${train.departure_station}</div>
              </div>

              <div class="flex flex-col items-center px-1">
                <span class="text-[9px] font-extrabold text-slate-400">${train.travel_time || 'Express'}</span>
                <div class="w-10 h-0.5 bg-slate-300 dark:bg-slate-600 my-0.5 relative">
                  <i class="fa-solid fa-chevron-right text-[7px] text-emerald-500 absolute -right-1 -top-1"></i>
                </div>
              </div>

              <div class="text-right">
                <div class="font-black text-slate-900 dark:text-white text-xs sm:text-sm">${train.arrival_time}</div>
                <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[90px] font-medium">${train.arrival_station}</div>
              </div>
            </div>

          </div>

          <!-- SEAT CLASSES MATRIX (Compact Grid with Bold Borders) -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 sm:gap-2">
            ${(train.seat_types || []).map(st => renderSeatPill(st, state.selectedFrom, state.selectedTo, state.selectedDate)).join('')}
          </div>

          <!-- BOTTOM ACTION FOOTER -->
          <div class="pt-2 border-t-2 border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            
            <!-- Left: Total Status & Quick Tools -->
            <div class="flex items-center space-x-1.5 flex-wrap gap-y-1">
              <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[11px] font-black ${
                hasAnySeats 
                  ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-2 border-emerald-300 dark:border-emerald-700' 
                  : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border-2 border-rose-300 dark:border-rose-800'
              }">
                <i class="fa-solid ${hasAnySeats ? 'fa-chair text-emerald-500' : 'fa-circle-xmark text-rose-500'} text-[10px]"></i>
                <span>${hasAnySeats ? `${grandTotal} Available` : 'SOLD OUT'}</span>
              </span>

              <button type="button" class="view-route-btn inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border-2 border-slate-300 dark:border-slate-700 transition cursor-pointer"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="View Train Route & Schedule">
                <i class="fa-solid fa-route text-emerald-500 text-[10px]"></i>
                <span>Routes</span>
              </button>

              <button type="button" class="view-station-matrix-btn inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border-2 border-emerald-300 dark:border-emerald-700 transition cursor-pointer"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="View Single-Day All-Station Blank Seat Matrix">
                <i class="fa-solid fa-table-cells text-emerald-600 dark:text-emerald-400 text-[10px]"></i>
                <span>Stops Matrix</span>
              </button>

              <button type="button" class="set-watch-btn inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 text-amber-700 dark:text-amber-300 border-2 border-amber-300 dark:border-amber-700 transition cursor-pointer"
                data-train-model="${train.train_model || ''}"
                data-train-name="${train.train_name || ''}"
                title="Set 24/7 seat drop alert">
                <i class="fa-solid fa-bell text-amber-500 text-[10px]"></i>
                <span>Alert Me</span>
              </button>
            </div>

            <!-- Right: Direct Book Now Button -->
            <div>
              <a href="${bookUrl}" target="_blank" rel="noopener" 
                class="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-xl text-xs font-black transition-all ${
                  hasAnySeats 
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-xs border border-emerald-500 active:scale-95' 
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-300 dark:border-slate-700 cursor-not-allowed opacity-60'
                }">
                <span>Book Now</span>
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
            </div>

          </div>

        </div>
      `;
    }).join('');
  }

  // ----------------------------------------------------
  // Compact Seat Class Pill Renderer
  // ----------------------------------------------------
  function renderSeatPill(seat, fromCity, toCity, journeyDate) {
    const onlineCount = Number(seat.seats_available || 0);
    const counterCount = Number(seat.counter_seats_available || 0);
    const totalSeatCount = onlineCount + counterCount;
    const isAvail = totalSeatCount > 0;
    
    const baseFare = Number(seat.fare || 0);
    const vat = Number(seat.vat || 0);
    const totalFare = Number(seat.total_fare !== undefined ? seat.total_fare : (baseFare + vat));

    const bookUrl = (fromCity && toCity && journeyDate)
      ? buildShohozBookingUrl(fromCity, toCity, journeyDate, seat.type || 'S_CHAIR')
      : '#';

    let cardBorder = '';
    let countBadge = '';

    if (isAvail) {
      cardBorder = 'border-2 border-emerald-400 dark:border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-100 hover:border-emerald-500 shadow-2xs';
      countBadge = `<div class="py-0.5 px-1 rounded-lg bg-emerald-600 text-white font-black text-[11px] text-center shadow-2xs">🟢 ${totalSeatCount} Seats</div>`;
    } else {
      cardBorder = 'border-2 border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-400 opacity-60';
      countBadge = `<div class="py-0.5 px-1 rounded-lg bg-slate-200 dark:bg-slate-700/90 text-slate-500 dark:text-slate-400 font-bold text-[10px] text-center">Sold Out</div>`;
    }

    return `
      <a href="${bookUrl}" target="_blank" rel="noopener"
        class="seat-pill block p-2 sm:p-2.5 rounded-xl border-2 ${cardBorder} flex flex-col justify-between space-y-1.5 transition ${isAvail ? 'cursor-pointer' : 'cursor-not-allowed'}"
        title="${isAvail ? `Book ${seat.display_name} (${totalSeatCount} available)` : `${seat.display_name} (Sold Out)`}"
        ${!isAvail ? 'tabindex="-1" aria-disabled="true" onclick="return false;"' : ''}>
        
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-black uppercase tracking-wider truncate">${seat.display_name}</span>
          ${isAvail ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>' : ''}
        </div>

        <div>
          ${countBadge}
        </div>

        <div class="pt-1 border-t-2 border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-xs">
          <span class="font-black text-xs text-slate-900 dark:text-white">৳${totalFare}</span>
          <span class="text-[9px] text-slate-500 dark:text-slate-400 font-bold">fare</span>
        </div>
      </a>
    `;
  }

  // ----------------------------------------------------
  // Compact Table View Renderer (Smooth Glancability & Clean Wrap)
  // ----------------------------------------------------
  function renderTableView(trains) {
    const dojParam = formatShohozDoj(state.selectedDate);

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

              return `
                <div class="inline-flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/70 text-xs shadow-2xs whitespace-nowrap">
                  <span class="font-bold text-slate-900 dark:text-white">${s.display_name || s.type}:</span>
                  <span class="px-1.5 py-0.2 rounded bg-emerald-600 text-white font-extrabold text-[10px]">🟢 ${totalCount}</span>
                  <span class="text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">৳${totalFare}</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        classesHtml = `
          <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 text-xs font-semibold">
            <i class="fa-solid fa-circle-xmark mr-1 text-rose-500 text-[10px]"></i> All Sold Out (0)
          </span>
        `;
      }

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
          <td class="px-3 py-2.5 align-middle sticky left-0 bg-white dark:bg-slate-900 z-10 sticky-column-shadow border-r border-slate-200/80 dark:border-slate-800">
            <div class="font-bold text-slate-900 dark:text-white whitespace-nowrap text-xs sm:text-sm">${train.train_name}</div>
            <div class="text-[10px] sm:text-[11px] text-slate-400 whitespace-nowrap">#${train.train_model} &bull; Off: ${train.off_day || 'None'}</div>
          </td>
          <td class="px-3 py-2.5 align-middle whitespace-nowrap">
            <div class="font-extrabold text-slate-900 dark:text-slate-100">${train.departure_time}</div>
            <div class="text-[11px] text-slate-400 truncate max-w-[110px]">${train.departure_station}</div>
          </td>
          <td class="px-3 py-2.5 align-middle whitespace-nowrap">
            <div class="font-extrabold text-slate-900 dark:text-slate-100">${train.arrival_time}</div>
            <div class="text-[11px] text-slate-400 truncate max-w-[110px]">${train.arrival_station}</div>
          </td>
          <td class="px-3 py-2.5 align-middle">
            ${classesHtml}
          </td>
          <td class="px-3 py-2.5 align-middle text-center whitespace-nowrap">
            ${hasAnySeats 
              ? `<span class="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-extrabold text-xs">🟢 ${grandTotal}</span>` 
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
                <span>Book</span>
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
      <table class="w-full text-left text-xs border-collapse min-w-[650px]">
        <thead>
          <tr class="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-extrabold border-b-2 border-slate-200 dark:border-slate-700">
            <th class="p-3 whitespace-nowrap sticky left-0 bg-slate-100 dark:bg-slate-800 z-20 sticky-column-shadow border-r-2 border-slate-200 dark:border-slate-700">Train</th>
            ${matrixDays.map(d => `
              <th class="p-2.5 text-center whitespace-nowrap cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition matrix-header-date border-r border-slate-200 dark:border-slate-800" data-date="${d.date}" title="Switch to this date">
                <div class="text-[10px] text-slate-400 font-mono">${d.day_name}</div>
                <div class="text-xs font-black text-slate-900 dark:text-white">${d.display_date}</div>
                <div class="text-[9px] font-black ${d.total_available_seats > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">
                  ${d.total_available_seats > 0 ? `🟢 ${d.total_available_seats}` : '🔴 0'}
                </div>
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody class="divide-y-2 divide-slate-100 dark:divide-slate-800 font-medium">
    `;

    uniqueTrains.forEach(train => {
      tableHtml += `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
          <td class="p-3 font-bold text-slate-900 dark:text-white whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900 z-10 sticky-column-shadow border-r-2 border-slate-200 dark:border-slate-700">
            <div class="text-xs font-black">${train.name}</div>
            <div class="text-[10px] text-slate-400 font-normal">#${train.model} &bull; ${train.departure_time} &bull; Off: ${train.off_day || 'None'}</div>
          </td>
      `;

      matrixDays.forEach(d => {
        const trainOnDay = (d.trains || []).find(t => t.train_model === train.model);
        if (!trainOnDay) {
          tableHtml += `
            <td class="p-2 text-center text-[10px] text-slate-400 dark:text-slate-600 bg-slate-50/50 dark:bg-slate-800/20 font-medium border-r border-slate-100 dark:border-slate-800/60">
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
            <td class="p-1.5 text-center cursor-pointer matrix-cell-click border-r border-slate-100 dark:border-slate-800/60" data-date="${d.date}" data-train-model="${train.model}" title="${classBreakdown}">
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

    watchMultiDateGrid.innerHTML = state.pendingWatchTarget.availableDates.map(dateStr => {
      const isSelected = selected.includes(dateStr);
      const parts = dateStr.split('-');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const dayName = days[d.getDay()];
      const dayNum = d.getDate();
      const monthName = months[d.getMonth()];

      const activeClass = isSelected
        ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs font-bold ring-2 ring-emerald-400/40'
        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-800 font-medium';

      return `
        <button type="button" class="watch-date-chip flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition cursor-pointer select-none ${activeClass}" data-date="${dateStr}">
          <span class="text-[9px] uppercase tracking-wider opacity-80">${dayName}</span>
          <span class="text-xs font-black">${dayNum}</span>
          <span class="text-[9px] opacity-80">${monthName}</span>
        </button>
      `;
    }).join('');

    if (watchSelectedDatesCount) {
      const count = selected.length;
      watchSelectedDatesCount.textContent = `Selected: ${count} date${count === 1 ? '' : 's'}`;
    }
  }

  function openSetWatchModal(train) {
    if (!train) return;
    
    // Generate next 10 booking days in local time
    const availableDates = [];
    const now = new Date();
    for (let i = 0; i < 10; i++) {
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

      const preferredTo = (initialTo || state.selectedTo || '').toLowerCase().trim();
      const matchTo = downstreamStops.find(c => c.toLowerCase() === preferredTo);

      if (matchTo) {
        currentStationMatrixTarget.selectedTos = new Set([matchTo]);
      } else {
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

        submitRegisterBtn.disabled = true;
        submitRegisterBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Creating Account & Sending Verification...';
        if (registerStatusMsg) registerStatusMsg.textContent = '';

        let firebaseUid = null;
        try {
          // Attempt Firebase Auth creation & dispatch email verification
          if (window.firebase && firebase.auth) {
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
              // If user already exists in Firebase Auth, we proceed to check local system
            }
          }

          const res = await fetch('/api/user-auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, username, password, firebaseUid, emailVerified: false })
          });
          const data = await res.json();

          if (data.success) {
            if (registerStatusMsg) {
              registerStatusMsg.innerHTML = `✅ <strong>Verification Email Sent!</strong><br><span class="text-[11px] font-normal">A verification link has been sent to <strong>${email}</strong>. Please check your inbox (and spam folder) to verify your account, then await administrator approval.</span>`;
              registerStatusMsg.className = 'text-xs font-bold text-center text-emerald-700 dark:text-emerald-300 p-3 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl border border-emerald-300 dark:border-emerald-700 space-y-1';
            }
            showToast(`✉️ Verification link sent to ${email}`, 'success');
            userRegisterForm.reset();
            setTimeout(() => {
              if (loginTabBtn) loginTabBtn.click();
              if (loginUsername) loginUsername.value = username;
            }, 6000);
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
          submitRegisterBtn.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Create Account & Send Verification';
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
    // Navigation Tabs Switching
    if (navSeatFinderBtn) {
      navSeatFinderBtn.addEventListener('click', () => switchMainTab('seats'));
    }
    if (navLiveTrackerBtn) {
      navLiveTrackerBtn.addEventListener('click', () => switchMainTab('tracker'));
    }

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
            liveNetworkLeafletMap.setView([23.8103, 90.4125], 7, { animate: true });
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
    const liveModalMapCenterBtn = document.getElementById('liveModalMapCenterBtn');
    const liveModalMapZoomInBtn = document.getElementById('liveModalMapZoomInBtn');
    const liveModalMapZoomOutBtn = document.getElementById('liveModalMapZoomOutBtn');

    if (liveModalMapFullscreenBtn) {
      liveModalMapFullscreenBtn.addEventListener('click', () => {
        toggleElementFullscreen(liveModalMapContainer, liveModalMapFullscreenIcon, liveModalLeafletMap);
      });
    }
    if (liveModalMapCenterBtn) {
      liveModalMapCenterBtn.addEventListener('click', () => {
        if (liveModalLeafletMap && state.currentModalTrainMarker) {
          liveModalLeafletMap.setView(state.currentModalTrainMarker.getLatLng(), 11, { animate: true });
          state.currentModalTrainMarker.openPopup();
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

  function switchMainTab(tab) {
    state.activeMainTab = tab;

    if (tab === 'tracker') {
      if (seatFinderSection) seatFinderSection.classList.add('hidden');
      if (liveTrackerSection) liveTrackerSection.classList.remove('hidden');

      if (navSeatFinderBtn) {
        navSeatFinderBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-white dark:hover:bg-slate-700 transition flex items-center justify-center space-x-1.5 cursor-pointer';
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
      if (seatFinderSection) seatFinderSection.classList.remove('hidden');

      if (navSeatFinderBtn) {
        navSeatFinderBtn.className = 'flex-1 md:flex-initial px-2 sm:px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer';
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

  function initOrUpdateNetworkMap(trains) {
    if (!window.L || !document.getElementById('liveNetworkLeafletMap')) return;

    if (!liveNetworkLeafletMap) {
      liveNetworkLeafletMap = L.map('liveNetworkLeafletMap', {
        center: [23.8103, 90.4125],
        zoom: 7,
        minZoom: 6,
        maxZoom: 18,
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
    liveNetworkMarkersGroup.clearLayers();

    const bounds = [];
    const isSingleSelectedTrain = (trains || []).length === 1;

    (trains || []).forEach(t => {
      let latLng = t.current_coords;
      if (!latLng || !latLng[0] || !latLng[1]) {
        latLng = t.from_coords;
      }
      if (!latLng || !latLng[0] || !latLng[1]) return;

      bounds.push(latLng);

      // In individual train mode, place station markers on origin & destination
      if (isSingleSelectedTrain && t.from_coords && t.to_coords && t.from_coords[0] && t.to_coords[0]) {
        bounds.push(t.from_coords);
        bounds.push(t.to_coords);

        const fromDot = L.circleMarker(t.from_coords, {
          radius: 6.5,
          fillColor: '#10b981',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1
        }).bindTooltip(`🚉 Origin: ${t.from}`, { permanent: true, direction: 'top', className: 'text-xs font-bold' });
        liveNetworkMarkersGroup.addLayer(fromDot);

        const toDot = L.circleMarker(t.to_coords, {
          radius: 6.5,
          fillColor: '#f43f5e',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1
        }).bindTooltip(`🏁 Destination: ${t.to}`, { permanent: true, direction: 'top', className: 'text-xs font-bold' });
        liveNetworkMarkersGroup.addLayer(toDot);
      }

      const delayMin = t.delay_minutes || 0;
      const status = t.status;
      let colorClass = 'bg-cyan-500';
      let ringClass = 'ring-cyan-500/40';
      if (status === 'completed' || status === 'arrived') {
        colorClass = 'bg-slate-400';
        ringClass = 'ring-slate-400/30';
      } else if (status === 'scheduled') {
        colorClass = 'bg-blue-500';
        ringClass = 'ring-blue-500/30';
      } else if (delayMin > 10) {
        colorClass = 'bg-amber-500';
        ringClass = 'ring-amber-500/40';
      } else {
        colorClass = 'bg-emerald-500';
        ringClass = 'ring-emerald-500/40';
      }

      const iconHtml = `
        <div class="relative flex items-center justify-center cursor-pointer group">
          <div class="w-7 h-7 rounded-full ${colorClass} text-white flex items-center justify-center text-[11px] shadow-lg ring-4 ${ringClass} animate-pulse">
            <i class="fa-solid fa-train"></i>
          </div>
          <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 font-mono text-[9px] font-black px-1 rounded bg-slate-900/90 text-white shadow-xs whitespace-nowrap pointer-events-none">#${t.train_no}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-live-train-icon',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16]
      });

      const popupContent = `
        <div class="p-1 space-y-1.5 min-w-[170px] text-slate-800">
          <div class="font-black text-xs text-cyan-700 flex items-center justify-between gap-1">
            <span>${escapeHtml(t.train_name)}</span>
            <span class="font-mono text-[10px] px-1 rounded bg-slate-100 font-bold">#${t.train_no}</span>
          </div>
          <div class="text-[11px] font-bold text-slate-600">${escapeHtml(t.from)} ➔ ${escapeHtml(t.to)}</div>
          <div class="flex items-center justify-between text-[10px] font-semibold pt-1 border-t border-slate-100">
            <span>${status === 'delayed' ? `Delay: +${delayMin}m` : (status === 'completed' ? 'Arrived' : (status === 'scheduled' ? 'Scheduled' : 'On Time'))}</span>
            <span class="font-mono font-bold">${t.progress_pct || 0}%</span>
          </div>
          <button type="button" class="w-full mt-1.5 py-1 px-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-bold transition flex items-center justify-center gap-1 view-live-train-btn cursor-pointer" data-train-no="${t.train_no}">
            <i class="fa-solid fa-route text-[10px]"></i>
            <span>View Full Journey</span>
          </button>
        </div>
      `;

      const marker = L.marker(latLng, { icon: customIcon }).bindPopup(popupContent);
      liveNetworkMarkersGroup.addLayer(marker);

      if (isSingleSelectedTrain) {
        setTimeout(() => marker.openPopup(), 200);
      }
    });

    if (bounds.length > 0) {
      liveNetworkLeafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: isSingleSelectedTrain ? 11 : 10 });
    }
  }

  function initOrUpdateModalMap(data) {
    if (!window.L || !document.getElementById('liveModalLeafletMap') || !data) return;

    if (!liveModalLeafletMap) {
      liveModalLeafletMap = L.map('liveModalLeafletMap', {
        center: [23.8103, 90.4125],
        zoom: 8,
        minZoom: 6,
        maxZoom: 18,
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
    const validCoords = [];

    stoppages.forEach((stop, idx) => {
      if (stop.lat && stop.lng) {
        const pt = [stop.lat, stop.lng];
        validCoords.push(pt);

        const isOrigin = idx === 0;
        const isDest = idx === stoppages.length - 1;
        const isPassed = stop.status === 'passed' || stop.status === 'departed' || (data.prev_stop_idx >= 0 && idx <= data.prev_stop_idx);
        const isNext = stop.status === 'next' || stop.station_name === data.next_stop;

        let radius = 5;
        let fillColor = '#94a3b8';
        if (isOrigin) {
          radius = 6.5;
          fillColor = '#10b981';
        } else if (isDest) {
          radius = 6.5;
          fillColor = '#f43f5e';
        } else if (isNext) {
          radius = 7.5;
          fillColor = '#06b6d4';
        } else if (isPassed) {
          fillColor = '#10b981';
        }

        const circleMarker = L.circleMarker(pt, {
          radius: radius,
          fillColor: fillColor,
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95
        }).bindPopup(`
          <div class="p-1 space-y-1 text-slate-800">
            <div class="font-black text-xs text-cyan-800">🚉 ${escapeHtml(stop.station_name)}${isOrigin ? ' (Origin)' : (isDest ? ' (Destination)' : '')}</div>
            <div class="text-[10px] text-slate-500 font-bold">Sched: ${stop.scheduled_time} • ${isPassed ? `Act: ${stop.actual_time || stop.scheduled_time}` : `ETA: ${stop.eta_time || stop.scheduled_time}`}</div>
            <div class="text-[9px] text-slate-400 font-mono">${stop.distance_km} km • ${stop.platform && stop.platform !== '—' ? `PF ${stop.platform}` : 'PF --'}</div>
          </div>
        `).bindTooltip(stop.station_name, { permanent: isOrigin || isDest || isNext, direction: 'top', className: 'text-xs font-bold' });

        liveModalMapLayerGroup.addLayer(circleMarker);
      }
    });

    // Determine current train position
    let trainCoord = null;
    if (data.prev_stop_idx >= 0 && data.prev_stop_idx < stoppages.length - 1) {
      const prevStop = stoppages[data.prev_stop_idx];
      const nextStop = stoppages[data.prev_stop_idx + 1];
      if (prevStop?.lat && prevStop?.lng && nextStop?.lat && nextStop?.lng) {
        const segPct = Math.min(1, Math.max(0, (data.segment_progress_pct || 50) / 100));
        trainCoord = [
          prevStop.lat + (nextStop.lat - prevStop.lat) * segPct,
          prevStop.lng + (nextStop.lng - prevStop.lng) * segPct
        ];
      }
    }
    if (!trainCoord && validCoords.length > 0) {
      trainCoord = validCoords[Math.min(validCoords.length - 1, Math.max(0, data.prev_stop_idx >= 0 ? data.prev_stop_idx : 0))];
    }

    if (validCoords.length > 0) {
      const routeBounds = L.latLngBounds(validCoords);
      if (trainCoord) routeBounds.extend(trainCoord);
      liveModalLeafletMap.fitBounds(routeBounds, { padding: [35, 35] });
    }

    if (trainCoord) {
      const trainIconHtml = `
        <div class="relative flex items-center justify-center">
          <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center text-xs shadow-xl ring-4 ring-cyan-400/40 animate-pulse">
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
        <div class="p-1 space-y-1 text-slate-800">
          <div class="font-black text-xs text-cyan-800">${escapeHtml(data.train_name)} #${data.train_no}</div>
          <div class="text-[10px] font-bold text-slate-600">Speed: ${data.speed || 0} km/h • Delay: +${data.delay_minutes || 0}m</div>
          <div class="text-[10px] font-bold text-cyan-600">Next: ${escapeHtml(data.next_stop)} (ETA ${data.next_eta || '--:--'})</div>
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
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPwaPrompt = e;
      if (pwaInstallBtn) {
        pwaInstallBtn.classList.remove('hidden');
        pwaInstallBtn.classList.add('flex');
      }
    });

    if (pwaInstallBtn) {
      pwaInstallBtn.addEventListener('click', async () => {
        if (!deferredPwaPrompt) return;
        deferredPwaPrompt.prompt();
        const choiceResult = await deferredPwaPrompt.userChoice;
        if (choiceResult && choiceResult.outcome === 'accepted') {
          console.log('[PWA] User accepted the install prompt');
          pwaInstallBtn.classList.add('hidden');
          pwaInstallBtn.classList.remove('flex');
        }
        deferredPwaPrompt = null;
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] 📱 App installed successfully');
      if (pwaInstallBtn) {
        pwaInstallBtn.classList.add('hidden');
        pwaInstallBtn.classList.remove('flex');
      }
      showToast('🎉 RailSeat BD installed as an App on your device!', 'success');
    });
  }

  // ----------------------------------------------------
  // Setup Master Event Listeners
  // ----------------------------------------------------
  function setupEventListeners() {
    updateMonitorUI(state.pollingInterval);
    startMonitorCountdownTicker();
    initNotificationCenter();
    initSettingsMenu();
    initWatchlist();
    initShareModule();
    initStationMatrixModule();
    initMultiDayMatrixControls();
    initLiveTrackerModule();
    initUserManagement();
    initPwaServiceWorker();

    // Delegate click for view route, watch, and station matrix buttons
    document.addEventListener('click', (e) => {
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
  }

});



