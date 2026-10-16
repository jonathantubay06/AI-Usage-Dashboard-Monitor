# Stops AI Token Monitor (the node process listening on port 7788).
$conn = Get-NetTCPConnection -LocalPort 7788 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
    "AI Token Monitor stopped."
} else {
    "AI Token Monitor was not running."
}
