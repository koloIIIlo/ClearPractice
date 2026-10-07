# Public fixture selected for independent filler annotations. Nothing uploads.
# PowerShell 7; audio/references remain in ignored samples/, never in Git.
$ErrorActionPreference = 'Stop'
$fixtureSpec = Get-Content (Join-Path $PSScriptRoot 'public-fixture.json') -Raw | ConvertFrom-Json
$samplesFolder = Join-Path $PSScriptRoot 'samples'
New-Item -ItemType Directory -Path $samplesFolder -Force | Out-Null
$rowsUrl = 'https://datasets-server.huggingface.co/rows?dataset=nyralabs%2Fdisfluency_speech_english&config=default&split=test&offset=0&length=100'
$datasetRows = Invoke-RestMethod -Uri $rowsUrl -TimeoutSec 60
$clips = @()
foreach ($expected in $fixtureSpec.clips) {
    $entry = @($datasetRows.rows | Where-Object { $_.row_idx -eq $expected.rowIndex })
    if ($entry.Count -ne 1 -or $entry[0].row.id -ne $expected.id) { throw 'Dataset row identity changed; review the fixture before downloading.' }
    $row = $entry[0].row
    $referenceHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($row.verbatim_transcript))).ToLowerInvariant()
    if ($referenceHash -ne $expected.referenceSha256) { throw 'Independent reference changed; preserve the previous benchmark.' }
    $audioUrl = [Uri]$row.audio[0].src
    if ($audioUrl.Scheme -ne 'https' -or $audioUrl.Host -ne 'datasets-server.huggingface.co') { throw 'Unexpected public audio recipient/source.' }
    $fileName = "$($expected.id).wav"
    $samplePath = Join-Path $samplesFolder $fileName
    if (-not (Test-Path -LiteralPath $samplePath)) {
        $partialPath = "$samplePath.part"
        if (Test-Path -LiteralPath $partialPath) { throw 'An interrupted download is present; review it before retrying.' }
        Invoke-WebRequest -Uri $audioUrl.AbsoluteUri -OutFile $partialPath -TimeoutSec 120
        if ((Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.sha256) { throw 'Audio checksum mismatch; no source was accepted.' }
        Move-Item -LiteralPath $partialPath -Destination $samplePath
    }
    if ((Get-FileHash -LiteralPath $samplePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.sha256) { throw 'Existing audio checksum mismatch; file preserved.' }
    $clips += @{ id=$expected.id; rowIndex=$expected.rowIndex; file=$fileName; sha256=$expected.sha256;
        durationSeconds=$row.duration_in_s; verbatim=$row.verbatim_transcript; intended=$row.intended_transcript }
}
$source = @{ dataset=$fixtureSpec.dataset; split=$fixtureSpec.split; source=$fixtureSpec.source; sourcePaper=$fixtureSpec.sourcePaper; license=$fixtureSpec.license; clips=$clips }
$source | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $samplesFolder 'public-reference-source.json') -Encoding utf8NoBOM
Write-Output 'Verified public clips and independent references. Run public_sample.py prepare next.'
