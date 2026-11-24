# LifeOS 一键编译 Android APK 脚本（Windows PowerShell）
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "[1/3] 构建前端并同步 Capacitor Android 资源..." -ForegroundColor Cyan
npm run cap:sync

# 自动探测常见 JDK 21 路径
if (-not $env:JAVA_HOME) {
  $jdkCandidates = @(
    "D:\tools\jdk-21",
    "C:\Program Files\Eclipse Adoptium\jdk-21*",
    "C:\Program Files\Microsoft\jdk-21*",
    "C:\Program Files\Android\Android Studio\jbr"
  )
  foreach ($pattern in $jdkCandidates) {
    $found = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
      $env:JAVA_HOME = $found.FullName
      $env:PATH = "$($env:JAVA_HOME)\bin;$env:PATH"
      break
    }
  }
}

# 自动探测常见 Android SDK 路径
if (-not $env:ANDROID_HOME) {
  $sdkCandidates = @(
    "D:\tools\android-sdk",
    "$env:LOCALAPPDATA\Android\Sdk",
    "C:\Android\Sdk",
    "D:\Android\Sdk"
  )
  foreach ($sdk in $sdkCandidates) {
    if (Test-Path $sdk) {
      $env:ANDROID_HOME = $sdk
      $env:ANDROID_SDK_ROOT = $sdk
      break
    }
  }
}

if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) {
  Write-Error "未检测到 JDK 21 或 Android SDK。请先安装 Android Studio（或运行 android-cli / GitHub Actions 云编译）。"
  exit 1
}

Write-Host "[2/3] 使用 Gradle 编译 Android Debug APK..." -ForegroundColor Cyan
Write-Host "  JAVA_HOME    = $env:JAVA_HOME"
Write-Host "  ANDROID_HOME = $env:ANDROID_HOME"

Set-Location (Join-Path $projectRoot "android")
.\gradlew.bat assembleDebug

$apkSource = Join-Path $projectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$releaseDir = Join-Path $projectRoot "release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$apkTarget = Join-Path $releaseDir "LifeOS-debug.apk"
Copy-Item -Force $apkSource $apkTarget

Write-Host "[3/3] 编译完成！安装包路径：$apkTarget" -ForegroundColor Green
