Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolRoot = Join-Path $repoRoot 'artifacts\android-toolchain'
New-Item -ItemType Directory -Path $toolRoot,(Join-Path $toolRoot 'jdk'),(Join-Path $toolRoot 'platform'),(Join-Path $toolRoot 'build-tools') -Force | Out-Null
$packages = @(
  @{ Name='jdk.zip'; Destination='jdk'; Url='https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'; Algorithm='SHA256'; Hash='A4DBAA05FCA4BD89D84584E58C459BD732EFEBB1722AF80AB13C6516832004F9' },
  @{ Name='platform.zip'; Destination='platform'; Url='https://dl.google.com/android/repository/platform-35_r02.zip'; Algorithm='SHA1'; Hash='0BB560A90A7A2CBD0DD8348224D518B638FE7949' },
  @{ Name='build-tools.zip'; Destination='build-tools'; Url='https://dl.google.com/android/repository/build-tools_r35_windows.zip'; Algorithm='SHA1'; Hash='AF059BB67CF7786F45EE0DB85E2D24985DF1B4B6' }
)
foreach ($package in $packages) {
  $archive = Join-Path $toolRoot $package.Name
  if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $package.Url -OutFile $archive }
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm $package.Algorithm).Hash
  if ($actual -ne $package.Hash) { throw "Checksum incorrecto en $($package.Name). Archivo conservado para revisión; no se extrae." }
  $destination = Join-Path $toolRoot $package.Destination
  Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
  Write-Output "$($package.Name): checksum verificado y extraído."
}
