Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "BATCH MEASUREMENT ENDPOINT TEST" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Test 1: Small valid batch
Write-Host "`n=== TEST 1: Valid batch (3 measurements) ===" -ForegroundColor Green
$batchValid = @{
    session_id = "31046070-0bbd-44e8-9126-6b113f157507"
    measurements = @(
        @{
            measured_at = "2026-02-25T10:30:00.000Z"
            latitude = 49.8175
            longitude = 15.4730
            distance_left = 250
            distance_right = 280
        },
        @{
            measured_at = "2026-02-25T10:30:01.000Z"
            latitude = 49.8176
            longitude = 15.4731
            distance_left = 255
            distance_right = 285
        },
        @{
            measured_at = "2026-02-25T10:30:02.000Z"
            latitude = 49.8177
            longitude = 15.4732
            distance_left = 260
            distance_right = 290
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "http://localhost:8000/api/measurements/batch" -Method POST -Body $batchValid -ContentType "application/json"
    Write-Host "✓ Success!" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

# Test 2: Mixed batch (valid + invalid)
Write-Host "`n=== TEST 2: Mixed batch (2 valid, 1 invalid GPS, 1 invalid distance) ===" -ForegroundColor Yellow
$batchMixed = @{
    session_id = "31046070-0bbd-44e8-9126-6b113f157507"
    measurements = @(
        @{
            measured_at = "2026-02-25T10:31:00.000Z"
            latitude = 49.8175
            longitude = 15.4730
            distance_left = 250
            distance_right = 280
        },
        @{
            measured_at = "2026-02-25T10:31:01.000Z"
            latitude = 150.0  # INVALID - out of range
            longitude = 15.4731
            distance_left = 255
            distance_right = 285
        },
        @{
            measured_at = "2026-02-25T10:31:02.000Z"
            latitude = 49.8177
            longitude = 15.4732
            distance_left = 20000  # INVALID - unrealistic (200m)
            distance_right = 290
        },
        @{
            measured_at = "2026-02-25T10:31:03.000Z"
            latitude = 49.8178
            longitude = 15.4733
            distance_left = 265
            distance_right = 295
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "http://localhost:8000/api/measurements/batch" -Method POST -Body $batchMixed -ContentType "application/json"
    Write-Host "✓ Success!" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

# Test 3: Large batch simulation (10 measurements)
Write-Host "`n=== TEST 3: Large batch (10 measurements) ===" -ForegroundColor Cyan
$measurements = @()
for ($i = 0; $i -lt 10; $i++) {
    $measurements += @{
        measured_at = (Get-Date).AddSeconds(-$i).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        latitude = 49.8175 + ($i * 0.0001)
        longitude = 15.4730 + ($i * 0.0001)
        distance_left = 250 + ($i * 5)
        distance_right = 280 + ($i * 5)
    }
}

$batchLarge = @{
    session_id = "31046070-0bbd-44e8-9126-6b113f157507"
    measurements = $measurements
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "http://localhost:8000/api/measurements/batch" -Method POST -Body $batchLarge -ContentType "application/json"
    Write-Host "✓ Success!" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

# Test 4: Invalid session
Write-Host "`n=== TEST 4: Invalid session ID ===" -ForegroundColor Magenta
$batchInvalidSession = @{
    session_id = "00000000-0000-0000-0000-000000000000"
    measurements = @(
        @{
            measured_at = "2026-02-25T10:32:00.000Z"
            latitude = 49.8175
            longitude = 15.4730
            distance_left = 250
            distance_right = 280
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "http://localhost:8000/api/measurements/batch" -Method POST -Body $batchInvalidSession -ContentType "application/json"
    Write-Host "✓ Success!" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "✗ Expected error (session not found):" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Yellow
}

# Check recent measurements
Write-Host "`n=== Checking recent measurements in DB ===" -ForegroundColor Cyan
try {
    $recent = Invoke-RestMethod -Uri "http://localhost:8000/api/measurements/recent?limit=5" -Method GET
    Write-Host "Recent measurements:" -ForegroundColor Green
    $recent | Select-Object id, session_id, latitude, longitude, is_valid | Format-Table
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "TESTS COMPLETE" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
