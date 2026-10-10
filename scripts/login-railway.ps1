param(
    [string]$Mobile = "",
    [string]$Password = "",
    [string]$CftResponse = ""
)

$Host.UI.RawUI.WindowTitle = "Shohoz Railway Mobile Auto-Login"
Set-Location -Path $PSScriptRoot\..

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚆 Bangladesh Railway (Shohoz) Native Mobile Auto-Login" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Prompt for credentials if not supplied as parameters
if (-not $Mobile) {
    $Mobile = Read-Host "Enter Railway Mobile Number (e.g. 017XXXXXXXX)"
}
if (-not $Password) {
    $securePass = Read-Host "Enter Railway Account Password" -AsSecureString
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass))
}

$cleanMobile = $Mobile.Trim()
if (-not $cleanMobile -or -not $Password) {
    Write-Host "[ERROR] Mobile number and password are required!" -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}

# 2. Check for fresh Cloudflare Turnstile token
if (-not $CftResponse) {
    # Check data/latest_turnstile_token.json
    $tokenFile = Join-Path (Get-Location) "data\latest_turnstile_token.json"
    if (Test-Path $tokenFile) {
        try {
            $tokenJson = Get-Content $tokenFile -Raw | ConvertFrom-Json
            if ($tokenJson.token) {
                $CftResponse = $tokenJson.token
                Write-Host "[INFO] Loaded Cloudflare Turnstile token from data\latest_turnstile_token.json" -ForegroundColor DarkCyan
            }
        } catch {}
    }
}

Write-Host "`n[1/3] Generating Android SSDK device fingerprint..." -ForegroundColor Yellow
$deviceId = [guid]::NewGuid().ToString()

# Generate authentic 160-char SHA-256 Shohoz SSDK device fingerprint
$sha = [System.Security.Cryptography.SHA256]::Create()
$enc = [System.Text.Encoding]::UTF8
$p1 = [BitConverter]::ToString($sha.ComputeHash($enc.GetBytes("${cleanMobile}_shohoz_k1"))).Replace("-","").ToLower()
$p2 = [BitConverter]::ToString($sha.ComputeHash($enc.GetBytes("${p1}_shohoz_k2"))).Replace("-","").ToLower()
$p3 = [BitConverter]::ToString($sha.ComputeHash($enc.GetBytes("${p2}_shohoz_k3"))).Replace("-","").ToLower()
$deviceKey = ($p1 + $p2 + $p3).Substring(0, 160)

# Exact requested User-Agent
$userAgent = "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Edg/154.0.0.0 Mobile Safari/537.36"

$headers = @{
    "Content-Type"  = "application/json"
    "User-Agent"    = $userAgent
    "x-platform"    = "android"
    "x-app-version" = "2.2.0"
    "x-device-id"   = $deviceId
    "x-device-key"  = $deviceKey
}

$bodyData = @{
    "mobile_number" = $cleanMobile
    "password"      = $Password
}
if ($CftResponse) {
    $bodyData["cft_response"] = $CftResponse
}
$body = $bodyData | ConvertTo-Json

Write-Host "[2/3] Impersonating Android client & sending direct POST to Shohoz..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "https://railspaapi.shohoz.com/v1.0/app/auth/sign-in" `
        -Method Post `
        -Headers $headers `
        -Body $body `
        -TimeoutSec 15

    $token = $response.data.token
    if (-not $token) { $token = $response.token }
    $user = $response.data.user
    if (-not $user) { $user = $response.user }

    if ($token) {
        Write-Host "`n✅ [3/3] Login SUCCESSFUL!" -ForegroundColor Green
        if ($user.name) {
            Write-Host "   Passenger Name: $($user.name)" -ForegroundColor White
        }
        Write-Host "   Token Preview : $($token.Substring(0, 15))...$($token.Substring($token.Length - 8))" -ForegroundColor Gray

        # Save session to data/session.json
        $sessionObj = @{
            token       = $token
            deviceId    = $deviceId
            deviceKey   = $deviceKey
            cookie      = $null
            user        = $user
            lastUpdated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }

        $sessionPath = Join-Path (Get-Location) "data\session.json"
        $sessionObj | ConvertTo-Json -Depth 5 | Set-Content -Path $sessionPath -Encoding UTF8
        Write-Host "   Session Saved : $sessionPath" -ForegroundColor DarkCyan

        # Copy token to clipboard
        try {
            Set-Clipboard -Value $token
            Write-Host "   Clipboard     : Active token copied to clipboard!" -ForegroundColor Green
        } catch {}

        Write-Host "`nClosing window in 2 seconds..." -ForegroundColor Yellow
        Start-Sleep -Seconds 2
        exit 0
    } else {
        Write-Host "`n[ERROR] No token received from server." -ForegroundColor Red
        Write-Host ($response | ConvertTo-Json) -ForegroundColor DarkGray
        Start-Sleep -Seconds 4
        exit 1
    }
} catch {
    $errBody = $null
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errBody = $reader.ReadToEnd()
        } catch {}
    }

    Write-Host "`n❌ [ERROR] Login failed (HTTP $($_.Exception.Response.StatusCode.value__))" -ForegroundColor Red
    
    if ($errBody -and $errBody -match "TURNSTILE_TOKEN_REQUIRED") {
        Write-Host "`n⚠️ Shohoz requires a Cloudflare Turnstile verification token (cft_response)." -ForegroundColor Yellow
        Write-Host "Reason: Shohoz's firewall detected a non-mobile IP and challenged the request." -ForegroundColor Gray
        Write-Host "`nSolutions:" -ForegroundColor Cyan
        Write-Host " 1. If you are logged in on eticket.railway.gov.bd in your browser:" -ForegroundColor White
        Write-Host "    Open DevTools (F12) -> Console -> run: copy(localStorage.getItem('token'))" -ForegroundColor White
        Write-Host "    Then paste it into data/session.json." -ForegroundColor Gray
        Write-Host " 2. Or pass the Turnstile token directly:" -ForegroundColor White
        Write-Host "    .\scripts\login-railway.ps1 -Mobile '$cleanMobile' -Password '...' -CftResponse '<token>'" -ForegroundColor Gray
    } elseif ($errBody -and $errBody -match "INVALID_CREDENTIALS") {
        Write-Host "Wrong mobile number or password. Please verify your credentials." -ForegroundColor Red
    } elseif ($errBody) {
        Write-Host "Server Response: $errBody" -ForegroundColor DarkRed
    } else {
        Write-Host "Details: $($_.Exception.Message)" -ForegroundColor DarkRed
    }

    Write-Host "`nPress Enter to exit..." -ForegroundColor Gray
    Read-Host
    exit 1
}
