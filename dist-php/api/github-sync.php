<?php
/**
 * Auto-Sync & GitHub Webhook Deployer
 * Automatically pulls latest updates or downloads the zip archive directly from GitHub into shared hosting
 */

header('Content-Type: application/json; charset=utf-8');

$repoUrl = 'https://github.com/mlinksbd14-tech/RailSeat-Finder-BD';
$targetDir = dirname(__DIR__);

// Optional Secret Token (Configure your own in cPanel / Webhook)
$secret = $_GET['secret'] ?? $_POST['secret'] ?? '';

// Check if git is available on shared hosting
$hasGit = false;
@exec('git --version 2>&1', $gitOutput, $gitRet);
if ($gitRet === 0) {
    $hasGit = true;
}

$output = [];
$success = false;

if ($hasGit && is_dir($targetDir . '/.git')) {
    // Git pull update
    @exec("cd " . escapeshellarg($targetDir) . " && git pull origin main 2>&1", $output, $returnVar);
    $success = ($returnVar === 0);
} else {
    // Fallback: Fetch latest commit info and zipball from GitHub
    $zipUrl = "$repoUrl/archive/refs/heads/main.zip";
    $tempZip = sys_get_temp_dir() . '/rail_latest_' . time() . '.zip';

    $fp = fopen($tempZip, 'w+');
    $ch = curl_init($zipUrl);
    curl_setopt($ch, CURLOPT_TIMEOUT, 50);
    curl_setopt($ch, CURLOPT_FILE, $fp);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'RailSeat-PHP-AutoSync');
    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    fclose($fp);

    if ($httpCode === 200 && class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($tempZip) === TRUE) {
            // Extract to temp folder first, then move dist-php or public
            $extractPath = sys_get_temp_dir() . '/rail_unzipped_' . time();
            @mkdir($extractPath, 0755, true);
            $zip->extractTo($extractPath);
            $zip->close();

            // Locate dist-php or public inside extracted directory
            $extractedDirs = glob($extractPath . '/*', GLOB_ONLYDIR);
            if (!empty($extractedDirs[0])) {
                $sourceDir = $extractedDirs[0] . '/dist-php';
                if (!is_dir($sourceDir)) {
                    $sourceDir = $extractedDirs[0] . '/public';
                }

                if (is_dir($sourceDir)) {
                    // Copy updated files
                    $files = new RecursiveIteratorIterator(
                        new RecursiveDirectoryIterator($sourceDir, RecursiveDirectoryIterator::SKIP_DOTS),
                        RecursiveIteratorIterator::SELF_FIRST
                    );
                    foreach ($files as $item) {
                        $destPath = $targetDir . DIRECTORY_SEPARATOR . $files->getSubPathName();
                        if ($item->isDir()) {
                            @mkdir($destPath, 0755, true);
                        } else {
                            @copy($item, $destPath);
                        }
                    }
                    $success = true;
                    $output[] = "Successfully synced latest files from $repoUrl";
                }
            }
            @unlink($tempZip);
        }
    } else {
        $output[] = "Direct git not detected on server. Set up cPanel Git Versioning or Webhook.";
    }
}

echo json_encode([
    'success' => $success,
    'repository' => $repoUrl,
    'timestamp' => date('c'),
    'git_available' => $hasGit,
    'logs' => $output
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
