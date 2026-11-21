Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot '..'))
$toolRoot = Join-Path $repoRoot 'artifacts\android-toolchain'
$jdk = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
$platform = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'platform') -Recurse -Filter android.jar -File | Select-Object -First 1
$aapt2 = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'build-tools') -Recurse -Filter aapt2.exe -File | Select-Object -First 1
if (-not $jdk -or -not $platform -or -not $aapt2) {
  & (Join-Path $appRoot 'prepare-toolchain.ps1')
  $jdk = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
  $platform = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'platform') -Recurse -Filter android.jar -File | Select-Object -First 1
  $aapt2 = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'build-tools') -Recurse -Filter aapt2.exe -File | Select-Object -First 1
}
if (-not $jdk -or -not $platform -or -not $aapt2) { throw 'No se encontró la toolchain Android tras prepararla.' }
$build = Join-Path $appRoot 'build'
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
$apkAssets = Join-Path $build 'assets'
New-Item -ItemType Directory -Path $build,$classes,$dex,(Join-Path $apkAssets 'assets') -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot 'dist\*') -Destination (Join-Path $apkAssets 'assets') -Recurse -Force
$java = Join-Path $jdk.FullName 'bin\java.exe'
$javac = Join-Path $jdk.FullName 'bin\javac.exe'
$jar = Join-Path $jdk.FullName 'bin\jar.exe'
$buildTools = $aapt2.Directory.FullName
function Require-Success([string]$stage) { if ($LASTEXITCODE -ne 0) { throw "Fallo en $stage (código $LASTEXITCODE)." } }

& $javac -encoding UTF-8 -source 8 -target 8 -bootclasspath $platform.FullName -d $classes (Join-Path $appRoot 'src\eu\tacto\android\MainActivity.java')
Require-Success 'compilación Java'
$classesJar = Join-Path $build 'classes.jar'
& $jar --create --file $classesJar -C $classes .
Require-Success 'empaquetado de clases'
& $java -cp (Join-Path $buildTools 'lib\d8.jar') com.android.tools.r8.D8 --min-api 26 --lib $platform.FullName --output $dex $classesJar
Require-Success 'compilación DEX'
$unsigned = Join-Path $build 'unsigned.apk'
& $aapt2.FullName link --manifest (Join-Path $appRoot 'AndroidManifest.xml') -I $platform.FullName --min-sdk-version 26 --target-sdk-version 35 -A $apkAssets -o $unsigned
Require-Success 'enlace Android y recursos web'
# Windows PowerShell 5.1 does not load System.IO.Compression (ZipArchiveMode) on its own.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  # aapt2 on Windows stores nested assets as "assets/assets\app.js". Android looks
  # assets up by exact name with forward slashes, so rename those entries.
  foreach ($entry in @($zip.Entries | Where-Object { $_.FullName.Contains('\') })) {
    $name = $entry.FullName.Replace('\', '/')
    $buffer = New-Object System.IO.MemoryStream
    $source = $entry.Open()
    try { $source.CopyTo($buffer) } finally { $source.Dispose() }
    $entry.Delete()
    # Audio and images are already compact; store them as aapt2 does.
    $level = if ($name -match '\.(wav|png|jpe?g|webp)$') { [System.IO.Compression.CompressionLevel]::NoCompression } else { [System.IO.Compression.CompressionLevel]::Optimal }
    $target = $zip.CreateEntry($name, $level).Open()
    try { $buffer.Position = 0; $buffer.CopyTo($target) } finally { $target.Dispose(); $buffer.Dispose() }
  }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $dex 'classes.dex'), 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
finally { $zip.Dispose() }
$aligned = Join-Path $build 'aligned.apk'
& (Join-Path $buildTools 'zipalign.exe') -f 4 $unsigned $aligned
Require-Success 'alineación APK'
$keystore = Join-Path $build 'local-test.p12'
if (-not (Test-Path -LiteralPath $keystore)) {
  & (Join-Path $jdk.FullName 'bin\keytool.exe') -genkeypair -keystore $keystore -storetype PKCS12 -storepass tactotest -keypass tactotest -alias tacto -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=TACTO Local Test, O=TACTO, C=ES'
  Require-Success 'certificado local de prueba'
}
$output = Join-Path $repoRoot 'artifacts\TACTO-Android.apk'
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
& $java -jar (Join-Path $buildTools 'lib\apksigner.jar') sign --ks $keystore --ks-key-alias tacto --ks-pass pass:tactotest --key-pass pass:tactotest --v4-signing-enabled false --out $output $aligned
Require-Success 'firma APK'
& $java -jar (Join-Path $buildTools 'lib\apksigner.jar') verify --verbose $output
Require-Success 'verificación de firma'
& $aapt2.FullName dump permissions $output
Require-Success 'verificación de permisos'
$check = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
  $names = @($check.Entries | ForEach-Object { $_.FullName })
  $bad = @($names | Where-Object { $_.Contains('\') })
  if ($bad.Count) { throw "El APK contiene rutas con barra invertida: $($bad[0])" }
  foreach ($required in @('classes.dex', 'assets/assets/index.html', 'assets/assets/lang-boot.js', 'assets/assets/i18n.js', 'assets/assets/app.js', 'assets/assets/missions.js', 'assets/assets/audio/voice-test.wav', 'assets/assets/audio/en-voice-test.wav')) {
    if ($names -notcontains $required) { throw "Falta en el APK: $required" }
  }
  "Rutas del APK verificadas: $($names.Count) entradas, $(@($names | Where-Object { $_ -like 'assets/assets/audio/*.wav' }).Count) narraciones."
} finally { $check.Dispose() }
Get-Item -LiteralPath $output | Select-Object FullName,Length
Get-FileHash -LiteralPath $output -Algorithm SHA256 | Select-Object Algorithm,Hash
