param(
    [Parameter(Mandatory = $true)][string]$ModelFolder,
    [switch]$Cuda
)
$ErrorActionPreference = 'Stop'
$ModelFolder = (Get-Item -LiteralPath $ModelFolder).FullName
$assets = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'whisper-assets.json') -Raw | ConvertFrom-Json
$runtimeRoot = Join-Path $PSScriptRoot 'runtime.local'
$samplesRoot = Join-Path $PSScriptRoot 'samples'
New-Item -ItemType Directory -Force -Path $runtimeRoot, $samplesRoot | Out-Null
foreach ($pack in $assets.models) {
    $modelPath = Join-Path $ModelFolder $pack.file
    if ((Get-Item -LiteralPath $modelPath).Length -ne $pack.bytes -or
        (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pack.sha256) {
        throw "Existing model failed verification: $($pack.id)"
    }
}
foreach ($runtime in $assets.runtimes) {
    if ($runtime.backend -eq 'cuda' -and -not $Cuda) { continue }
    $archive = Join-Path $runtimeRoot ([System.Uri]$runtime.url).Segments[-1]
    if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $runtime.url -OutFile $archive }
    if ((Get-Item -LiteralPath $archive).Length -ne $runtime.archiveBytes -or
        (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtime.archiveSha256) {
        throw "Release archive failed verification: $($runtime.backend)"
    }
    $destination = Join-Path $runtimeRoot $runtime.backend
    # Use a new folder rather than merging with a potentially modified runtime.
    if (-not (Test-Path -LiteralPath $destination)) { Expand-Archive -LiteralPath $archive -DestinationPath $destination }
    $exe = Join-Path $destination 'Release/whisper-cli.exe'
    if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtime.executableSha256) {
        throw 'Extracted worker failed verification'
    }
    # Compare DLLs to their bytes in the verified archive before fingerprinting.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    $supplementZip = $null
    try {
        if ($null -ne $runtime.supplemental) {
            $supplement = $runtime.supplemental
            $supplementArchive = Join-Path $runtimeRoot ([System.Uri]$supplement.url).Segments[-1]
            if (-not (Test-Path -LiteralPath $supplementArchive)) { Invoke-WebRequest -Uri $supplement.url -OutFile $supplementArchive }
            if ((Get-Item -LiteralPath $supplementArchive).Length -ne $supplement.archiveBytes -or
                (Get-FileHash -LiteralPath $supplementArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $supplement.archiveSha256) { throw 'NVIDIA runtime archive failed verification' }
            $supplementZip = [System.IO.Compression.ZipFile]::OpenRead($supplementArchive)
            foreach ($library in $supplement.libraries) {
                $entry = $supplementZip.GetEntry($supplement.folder + '/bin/' + $library)
                if ($null -eq $entry) { throw 'NVIDIA runtime library missing from verified archive' }
                $destinationFile = Join-Path (Split-Path -Parent $exe) $library
                if (-not (Test-Path -LiteralPath $destinationFile)) {
                    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destinationFile)
                }
            }
            $license = $supplementZip.GetEntry($supplement.folder + '/LICENSE')
            if ($null -eq $license) { throw 'NVIDIA runtime license missing from verified archive' }
            $licensePath = Join-Path $destination 'LICENSE-cuBLAS.txt'
            if (-not (Test-Path -LiteralPath $licensePath)) {
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($license, $licensePath)
            }
        }
        $files = @(Get-ChildItem -LiteralPath (Split-Path -Parent $exe) -File | Where-Object { $_.Extension -eq '.dll' -or $_.Name -eq 'whisper-cli.exe' } | ForEach-Object {
            $file = $_
            $entry = $zip.GetEntry('Release/' + $file.Name)
            if ($null -eq $entry -and $null -ne $supplementZip -and $runtime.supplemental.libraries -contains $file.Name) {
                $entry = $supplementZip.GetEntry($runtime.supplemental.folder + '/bin/' + $file.Name)
            }
            if ($null -eq $entry) { throw 'Unverified file in extracted runtime' }
            $stream = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $expected = [System.Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant() }
            finally { $stream.Dispose(); $sha.Dispose() }
            $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($expected -ne $actual) { throw 'Extracted runtime library failed verification' }
            @{ name=$file.Name; bytes=$file.Length; sha256=$actual }
        })
    } finally {
        $zip.Dispose()
        if ($null -ne $supplementZip) { $supplementZip.Dispose() }
    }
    foreach ($pack in $assets.models) {
        $config = @{
            version=1; runtimeVersion=$assets.runtimeVersion; executable=$exe; runtimeFiles=$files
            model=(Join-Path $ModelFolder $pack.file); modelId=$pack.id; modelSha256=$pack.sha256
            backend=$runtime.backend; threads=4; prompt=$null
        }
        $config | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $runtimeRoot "config-$($runtime.backend)-$($pack.id).json")
    }
    Write-Output "Verified $($runtime.backend) worker and both existing models"
}
$fixturePath = Join-Path $samplesRoot 'jfk.wav'
$selection = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'selected-profile.json') -Raw | ConvertFrom-Json
$choice = if ($Cuda) { $selection } else { $selection.explicitAlternative }
$selected = Get-Content -LiteralPath (Join-Path $runtimeRoot "config-$($choice.backend)-$($choice.modelId).json") -Raw | ConvertFrom-Json
$selected.threads = $selection.threads
$selected.prompt = $choice.prompt
$selected | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $runtimeRoot 'config-selected.json')
if (-not (Test-Path -LiteralPath $fixturePath)) { Invoke-WebRequest -Uri $assets.fixture.url -OutFile $fixturePath }
if ((Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $assets.fixture.sha256) { throw 'Fixture checksum mismatch' }
