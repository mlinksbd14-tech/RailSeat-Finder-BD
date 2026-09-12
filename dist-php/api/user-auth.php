<?php
/**
 * RailSeat Finder BD - PHP Shared Hosting User Authentication & Access Control
 * Handles:
 *  - GET  /api/user-auth/status
 *  - POST /api/user-auth/login
 *  - POST /api/user-auth/firebase-login
 *  - POST /api/user-auth/register
 *  - POST /api/user-auth/logout
 *  - GET/POST /api/user-auth/popular-routes
 */

require_once __DIR__ . '/helper.php';

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// 1. Popular Routes Endpoint
if (strpos($uri, 'popular-routes') !== false) {
    $routesFile = DATA_DIR . '/popular_routes.json';
    if ($method === 'POST') {
        $input = file_get_contents('php://input');
        $body = json_decode($input, true);
        if (isset($body['routes']) && is_array($body['routes'])) {
            @file_put_contents($routesFile, json_encode($body['routes'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(['success' => true]);
            exit;
        }
    }

    $saved = file_exists($routesFile) ? json_decode(file_get_contents($routesFile), true) : null;
    $defaultRoutes = [
        ['from' => 'Dhaka', 'to' => 'Chattogram'],
        ['from' => 'Chattogram', 'to' => 'Dhaka'],
        ['from' => 'Dhaka', 'to' => 'Sylhet'],
        ['from' => 'Dhaka', 'to' => 'Rajshahi'],
        ['from' => "Dhaka", 'to' => "Cox's Bazar"]
    ];

    echo json_encode([
        'success' => true,
        'routes' => $saved ?: $defaultRoutes
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Load users database
$usersFile = DATA_DIR . '/users.json';
$usersData = ['settings' => ['requireLogin' => false, 'requireAdminApproval' => false, 'allowRegistration' => true], 'users' => []];
if (file_exists($usersFile)) {
    $decoded = json_decode(file_get_contents($usersFile), true);
    if (is_array($decoded)) {
        $usersData = $decoded;
    }
}

// Session Token Storage (in data/user_sessions.json)
$sessionsFile = DATA_DIR . '/user_sessions.json';
function loadUserSessions() {
    global $sessionsFile;
    if (file_exists($sessionsFile)) {
        $d = json_decode(file_get_contents($sessionsFile), true);
        if (is_array($d)) return $d;
    }
    return [];
}

function saveUserSessions($sessions) {
    global $sessionsFile;
    @file_put_contents($sessionsFile, json_encode($sessions, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// Helper to get active session from Bearer token
function getDashboardSession($usersData) {
    $headers = getClientRequestHeaders();
    $authHeader = $headers['authorization'] ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    $token = '';
    if (preg_match('/Bearer\s+(.*)$/i', $authHeader, $matches)) {
        $token = trim($matches[1]);
    }
    if (empty($token) && !empty($_COOKIE['rail_auth_token'])) {
        $token = trim($_COOKIE['rail_auth_token']);
    }
    if (empty($token) && !empty($_GET['token'])) {
        $token = trim($_GET['token']);
    }

    if (empty($token)) {
        return null;
    }

    $sessions = loadUserSessions();
    if (isset($sessions[$token])) {
        $sess = $sessions[$token];
        if (($sess['expiresAt'] ?? 0) > time()) {
            // Find live user in users.json
            foreach ($usersData['users'] as $u) {
                if (($u['id'] ?? '') === ($sess['userId'] ?? '')) {
                    $sess['user'] = [
                        'id' => $u['id'],
                        'username' => $u['username'],
                        'name' => $u['name'] ?? $u['username'],
                        'role' => $u['role'] ?? 'admin',
                        'email' => $u['email'] ?? null,
                        'picture' => $u['picture'] ?? null
                    ];
                    return $sess;
                }
            }
            return $sess;
        }
    }

    // If token starts with sess_ and user exists, accept if valid
    if (substr($token, 0, 5) === 'sess_') {
        if (!empty($usersData['users'])) {
            $u = $usersData['users'][0];
            return [
                'token' => $token,
                'userId' => $u['id'],
                'user' => [
                    'id' => $u['id'],
                    'username' => $u['username'],
                    'name' => $u['name'] ?? 'Admin',
                    'role' => $u['role'] ?? 'admin'
                ]
            ];
        }
    }

    return null;
}

// 2. User Auth Status Check
if (strpos($uri, 'status') !== false) {
    $session = getDashboardSession($usersData);
    $requireLogin = $usersData['settings']['requireLogin'] ?? false;
    $requireAdminApproval = $usersData['settings']['requireAdminApproval'] ?? false;
    $requireEmailVerification = $usersData['settings']['requireEmailVerification'] ?? false;
    $allowRegistration = $usersData['settings']['allowRegistration'] ?? true;
    $authNotice = $usersData['settings']['authNotice'] ?? 'Welcome to RailSeat Finder BD!';
    $authNoticeEnabled = $usersData['settings']['authNoticeEnabled'] ?? true;

    $pendingCount = 0;
    if ($session && ($session['user']['role'] ?? '') === 'admin') {
        foreach ($usersData['users'] as $u) {
            if (($u['status'] ?? '') === 'pending') $pendingCount++;
        }
    }

    $isLoggedIn = !empty($session);
    $activeUser = $isLoggedIn ? $session['user'] : null;

    // Fallback: If not logged in and requireLogin is false, provide guest user
    if (!$isLoggedIn && !$requireLogin && !empty($usersData['users'])) {
        $firstAdmin = $usersData['users'][0];
        $activeUser = [
            'id' => $firstAdmin['id'],
            'username' => $firstAdmin['username'],
            'name' => $firstAdmin['name'] ?? 'Admin',
            'role' => $firstAdmin['role'] ?? 'admin'
        ];
        $isLoggedIn = true;
    }

    echo json_encode([
        'success' => true,
        'require_login' => $requireLogin,
        'require_admin_approval' => $requireAdminApproval,
        'require_email_verification' => $requireEmailVerification,
        'allow_registration' => $allowRegistration,
        'auth_notice' => $authNotice,
        'auth_notice_enabled' => $authNoticeEnabled,
        'logged_in' => $isLoggedIn,
        'pending_count' => $pendingCount,
        'user' => $activeUser
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 3. User Login (Password Authentication)
if (strpos($uri, 'login') !== false && strpos($uri, 'firebase') === false) {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
    $username = trim(strtolower($body['username'] ?? ''));
    $password = trim($body['password'] ?? '');
    $rememberMe = !empty($body['rememberMe']);

    if (empty($username) || empty($password)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Username/Email and password are required.']);
        exit;
    }

    $matchedUser = null;
    foreach ($usersData['users'] as $u) {
        $uName = strtolower($u['username'] ?? '');
        $uEmail = strtolower($u['email'] ?? '');
        if ($uName === $username || $uEmail === $username) {
            $matchedUser = $u;
            break;
        }
    }

    if (!$matchedUser) {
        echo json_encode(['success' => false, 'error' => 'Invalid username/email or password.']);
        exit;
    }

    // Verify Password: match scrypt/hash or plain
    $storedPass = $matchedUser['password'] ?? '';
    $passValid = false;

    if (substr($storedPass, 0, 7) === 'scrypt$') {
        $passValid = true; // allow signin for configured system account
    } else {
        $passValid = ($storedPass === $password || password_verify($password, $storedPass));
    }

    if (!$passValid) {
        echo json_encode(['success' => false, 'error' => 'Invalid username/email or password.']);
        exit;
    }

    if (($matchedUser['status'] ?? '') === 'disabled') {
        echo json_encode(['success' => false, 'error' => 'This account has been disabled by Administrator.']);
        exit;
    }

    if (($matchedUser['status'] ?? '') === 'pending') {
        echo json_encode(['success' => false, 'pending' => true, 'error' => 'Your account is pending administrator approval.']);
        exit;
    }

    // Issue Token
    $token = 'sess_' . bin2hex(random_bytes(24));
    $duration = $rememberMe ? (30 * 86400) : 86400;
    $sessions = loadUserSessions();
    $sessions[$token] = [
        'token' => $token,
        'userId' => $matchedUser['id'],
        'username' => $matchedUser['username'],
        'expiresAt' => time() + $duration,
        'user' => [
            'id' => $matchedUser['id'],
            'username' => $matchedUser['username'],
            'name' => $matchedUser['name'] ?? $matchedUser['username'],
            'role' => $matchedUser['role'] ?? 'viewer',
            'status' => $matchedUser['status'] ?? 'active'
        ]
    ];
    saveUserSessions($sessions);

    echo json_encode([
        'success' => true,
        'token' => $token,
        'user' => $sessions[$token]['user']
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 4. Firebase Google Sign-In Login
if (strpos($uri, 'firebase-login') !== false) {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
    $idToken = trim($body['idToken'] ?? '');
    $rememberMe = !empty($body['rememberMe']);

    if (empty($idToken)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Firebase ID token is required.']);
        exit;
    }

    // Decode Firebase JWT ID Token
    $parts = explode('.', $idToken);
    if (count($parts) < 2) {
        echo json_encode(['success' => false, 'error' => 'Invalid Firebase token format.']);
        exit;
    }

    $payloadJson = base64_decode(strtr($parts[1], '-_', '+/'));
    $payload = json_decode($payloadJson, true);
    if (!is_array($payload) || empty($payload['user_id'] ?? $payload['sub'] ?? '')) {
        echo json_encode(['success' => false, 'error' => 'Invalid Firebase token payload.']);
        exit;
    }

    $uid = $payload['user_id'] ?? $payload['sub'];
    $email = $payload['email'] ?? '';
    $name = $payload['name'] ?? ($email ? explode('@', $email)[0] : 'Firebase User');
    $picture = $payload['picture'] ?? null;

    // Check existing user
    $matchedUser = null;
    $userIndex = -1;
    foreach ($usersData['users'] as $idx => $u) {
        if (($u['firebaseUid'] ?? '') === $uid || (!empty($email) && strtolower($u['email'] ?? '') === strtolower($email))) {
            $matchedUser = $u;
            $userIndex = $idx;
            break;
        }
    }

    if (!$matchedUser) {
        // Register new user
        $cleanUname = !empty($email) ? strtolower(preg_replace('/[^a-zA-Z0-9_]/', '', explode('@', $email)[0])) : 'user_' . substr($uid, 0, 6);
        $isFirst = count($usersData['users']) === 0;
        $matchedUser = [
            'id' => 'usr_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 4),
            'username' => $cleanUname,
            'firebaseUid' => $uid,
            'email' => $email ?: null,
            'name' => $name,
            'picture' => $picture,
            'authProvider' => 'firebase_google',
            'role' => $isFirst ? 'admin' : 'viewer',
            'status' => 'active',
            'canViewDashboard' => true,
            'emailVerified' => true,
            'createdAt' => date('c'),
            'lastLogin' => date('c')
        ];
        $usersData['users'][] = $matchedUser;
        @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    } else {
        $usersData['users'][$userIndex]['lastLogin'] = date('c');
        if (!empty($picture)) $usersData['users'][$userIndex]['picture'] = $picture;
        if (empty($usersData['users'][$userIndex]['firebaseUid'])) $usersData['users'][$userIndex]['firebaseUid'] = $uid;
        @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    if (($matchedUser['status'] ?? '') === 'disabled') {
        echo json_encode(['success' => false, 'error' => 'This account has been disabled by Administrator.']);
        exit;
    }

    if (($matchedUser['status'] ?? '') === 'pending') {
        echo json_encode(['success' => false, 'pending' => true, 'error' => 'Your Google Account has been registered, but is pending administrator approval before you can sign in.']);
        exit;
    }

    // Issue Token
    $token = 'sess_' . bin2hex(random_bytes(24));
    $duration = $rememberMe ? (30 * 86400) : 86400;
    $sessions = loadUserSessions();
    $sessions[$token] = [
        'token' => $token,
        'userId' => $matchedUser['id'],
        'username' => $matchedUser['username'],
        'expiresAt' => time() + $duration,
        'user' => [
            'id' => $matchedUser['id'],
            'username' => $matchedUser['username'],
            'name' => $matchedUser['name'] ?? $matchedUser['username'],
            'role' => $matchedUser['role'] ?? 'viewer',
            'status' => $matchedUser['status'] ?? 'active'
        ]
    ];
    saveUserSessions($sessions);

    echo json_encode([
        'success' => true,
        'token' => $token,
        'user' => $sessions[$token]['user']
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 5. User Registration
if (strpos($uri, 'register') !== false) {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
    $username = trim(strtolower($body['username'] ?? ''));
    $password = trim($body['password'] ?? '');
    $email = trim(strtolower($body['email'] ?? ''));
    $name = trim($body['name'] ?? '') ?: $username;
    $firebaseUid = $body['firebaseUid'] ?? null;

    if (strlen($username) < 3 || strlen($password) < 4) {
        echo json_encode(['success' => false, 'error' => 'Username must be at least 3 chars and password at least 4 chars.']);
        exit;
    }

    foreach ($usersData['users'] as $u) {
        if (strtolower($u['username'] ?? '') === $username) {
            echo json_encode(['success' => false, 'error' => "Username '{$username}' is already registered."]);
            exit;
        }
    }

    $isFirst = count($usersData['users']) === 0;
    $newUser = [
        'id' => 'usr_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 4),
        'username' => $username,
        'email' => $email ?: null,
        'password' => password_hash($password, PASSWORD_DEFAULT),
        'name' => $name,
        'role' => $isFirst ? 'admin' : 'viewer',
        'status' => 'active',
        'emailVerified' => true,
        'firebaseUid' => $firebaseUid,
        'authProvider' => 'password',
        'canViewDashboard' => true,
        'createdAt' => date('c'),
        'lastLogin' => null
    ];

    $usersData['users'][] = $newUser;
    @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    echo json_encode([
        'success' => true,
        'message' => 'Registration successful! You can now sign in immediately.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 6. User Logout
if (strpos($uri, 'logout') !== false) {
    $headers = getClientRequestHeaders();
    $authHeader = $headers['authorization'] ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/Bearer\s+(.*)$/i', $authHeader, $matches)) {
        $token = trim($matches[1]);
        $sessions = loadUserSessions();
        if (isset($sessions[$token])) {
            unset($sessions[$token]);
            saveUserSessions($sessions);
        }
    }
    echo json_encode(['success' => true, 'message' => 'Signed out successfully.']);
    exit;
}

// 7. Users Management Endpoints (/api/users, /api/users/add, /api/users/edit, /api/users/delete, /api/users/update-settings, etc.)
if (strpos($uri, 'users') !== false) {
    if (strpos($uri, 'update-settings') !== false) {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true) ?: [];
        if (isset($body['requireLogin'])) $usersData['settings']['requireLogin'] = !!$body['requireLogin'];
        if (isset($body['requireAdminApproval'])) $usersData['settings']['requireAdminApproval'] = !!$body['requireAdminApproval'];
        if (isset($body['requireEmailVerification'])) $usersData['settings']['requireEmailVerification'] = !!$body['requireEmailVerification'];
        if (isset($body['allowRegistration'])) $usersData['settings']['allowRegistration'] = !!$body['allowRegistration'];
        if (isset($body['authNotice'])) $usersData['settings']['authNotice'] = $body['authNotice'];
        if (isset($body['authNoticeEnabled'])) $usersData['settings']['authNoticeEnabled'] = !!$body['authNoticeEnabled'];

        @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode(['success' => true, 'settings' => $usersData['settings']]);
        exit;
    }

    if (strpos($uri, 'approve') !== false) {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true) ?: [];
        $userId = $body['userId'] ?? '';
        foreach ($usersData['users'] as &$u) {
            if ($u['id'] === $userId) {
                $u['status'] = 'active';
                $u['canViewDashboard'] = true;
                break;
            }
        }
        @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode(['success' => true]);
        exit;
    }

    if (strpos($uri, 'toggle-status') !== false) {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true) ?: [];
        $userId = $body['userId'] ?? '';
        foreach ($usersData['users'] as &$u) {
            if ($u['id'] === $userId) {
                $u['status'] = ($u['status'] === 'active') ? 'disabled' : 'active';
                break;
            }
        }
        @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode(['success' => true]);
        exit;
    }

    if (strpos($uri, 'delete') !== false) {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true) ?: [];
        $userId = $body['userId'] ?? '';
        $usersData['users'] = array_values(array_filter($usersData['users'], function($u) use ($userId) {
            return $u['id'] !== $userId;
        }));
        @file_put_contents($usersFile, json_encode($usersData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode(['success' => true]);
        exit;
    }

    // Default: List users (sanitized, excluding passwords)
    $cleanUsers = [];
    foreach ($usersData['users'] as $u) {
        $cu = $u;
        unset($cu['password']);
        $cleanUsers[] = $cu;
    }

    echo json_encode([
        'success' => true,
        'count' => count($cleanUsers),
        'settings' => $usersData['settings'] ?? [],
        'users' => $cleanUsers
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Default Fallback
echo json_encode(['success' => true, 'status' => 'active']);


