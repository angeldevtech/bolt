[CmdletBinding()]
param(
    [switch]$Refresh,
    [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ManifestPath = Join-Path $scriptDirectory '..\binaries\manifest.json'
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $algorithm.ComputeHash($stream)
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }

    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Assert-Sha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Description
    )

    $actual = Get-Sha256 -Path $Path
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Description. Expected $Expected, got $actual."
    }
}

$manifestPath = [IO.Path]::GetFullPath($ManifestPath)
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Binary manifest not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $manifest.tools -or $manifest.tools.Count -eq 0) {
    throw "Binary manifest contains no tools: $manifestPath"
}

$binariesDirectory = Split-Path -Parent $manifestPath
if (-not (Test-Path -LiteralPath $binariesDirectory -PathType Container)) {
    throw "Binary output directory not found: $binariesDirectory"
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("bolt-binaries-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    foreach ($tool in $manifest.tools) {
        if ([string]::IsNullOrWhiteSpace($tool.file) -or [string]::IsNullOrWhiteSpace($tool.url)) {
            throw "Binary manifest entry is missing file or url."
        }

        $destination = Join-Path $binariesDirectory $tool.file
        $expectedHash = $tool.sha256.ToLowerInvariant()

        if ($expectedHash -notmatch '^[0-9a-f]{64}$') {
            throw "Invalid SHA-256 value for $($tool.name): $($tool.sha256)"
        }

        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $existingHash = Get-Sha256 -Path $destination
            if ($existingHash -eq $expectedHash) {
                Write-Host "Verified $($tool.file) ($($tool.version))."
                continue
            }

            if (-not $Refresh) {
                throw "Existing $($tool.file) does not match pinned SHA-256. Run with -Refresh to replace it."
            }

            Write-Host "Refreshing mismatched $($tool.file)."
        }
        else {
            Write-Host "Downloading missing $($tool.file)."
        }

        $downloadFileName = if ([string]::IsNullOrWhiteSpace($tool.archiveSha256)) {
            $tool.file + '.download'
        }
        else {
            $tool.file + '.zip'
        }
        $downloadPath = Join-Path $tempRoot $downloadFileName
        Invoke-WebRequest -Uri $tool.url -OutFile $downloadPath -UseBasicParsing

        if (-not [string]::IsNullOrWhiteSpace($tool.archiveSha256)) {
            $archiveHash = $tool.archiveSha256.ToLowerInvariant()
            if ($archiveHash -notmatch '^[0-9a-f]{64}$') {
                throw "Invalid archive SHA-256 value for $($tool.name): $($tool.archiveSha256)"
            }
            Assert-Sha256 -Path $downloadPath -Expected $archiveHash -Description "$($tool.name) archive"

            $extractPath = Join-Path $tempRoot ($tool.file + '-extract')
            Expand-Archive -LiteralPath $downloadPath -DestinationPath $extractPath -Force
            $sourcePath = Join-Path $extractPath $tool.archivePath
        }
        else {
            $sourcePath = $downloadPath
        }

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Expected $($tool.file) was not found at archive path '$($tool.archivePath)'."
        }

        Assert-Sha256 -Path $sourcePath -Expected $expectedHash -Description "$($tool.name) executable"

        $stagingPath = Join-Path $binariesDirectory ('.' + $tool.file + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
        try {
            Copy-Item -LiteralPath $sourcePath -Destination $stagingPath
            Assert-Sha256 -Path $stagingPath -Expected $expectedHash -Description "$($tool.name) staged executable"
            Move-Item -LiteralPath $stagingPath -Destination $destination -Force
        }
        finally {
            Remove-Item -LiteralPath $stagingPath -Force -ErrorAction SilentlyContinue
        }

        Write-Host "Provisioned and verified $($tool.file) ($($tool.version))."
    }
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'All pinned Windows sidecars are ready.'
