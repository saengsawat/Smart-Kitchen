# Regenerates BACKLOG_TRACKER.xlsx from BACKLOG_TRACKER.csv via Excel COM.
# Usage (close BACKLOG_TRACKER.xlsx in Excel first, the file is replaced):
#   powershell -NoProfile -File scripts/regen-tracker-xlsx.ps1
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Andy\OneDrive\006_Smart Kitchen App'
$csv  = Join-Path $repo 'BACKLOG_TRACKER.csv'
$xlsx = Join-Path $repo 'BACKLOG_TRACKER.xlsx'

$rows = Import-Csv -Path $csv -Encoding UTF8
$headers = ($rows | Select-Object -First 1).PSObject.Properties.Name

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = 'Backlog'

  # Header
  for ($c = 0; $c -lt $headers.Count; $c++) {
    $ws.Cells.Item(1, $c + 1).Value2 = $headers[$c]
  }
  # Body
  $r = 2
  foreach ($row in $rows) {
    for ($c = 0; $c -lt $headers.Count; $c++) {
      $v = $row.($headers[$c])
      if ($null -eq $v) { $v = '' }
      $ws.Cells.Item($r, $c + 1).Value2 = [string]$v
    }
    $r++
  }

  $used = $ws.UsedRange
  $header = $ws.Range($ws.Cells.Item(1,1), $ws.Cells.Item(1,$headers.Count))
  $header.Font.Bold = $true
  $header.Interior.Color = 0xDCE6E8   # light warm grey (BGR)
  $ws.Application.ActiveWindow.SplitRow = 1
  $ws.Application.ActiveWindow.FreezePanes = $true
  $used.AutoFilter() | Out-Null
  $used.WrapText = $false
  $used.Columns.AutoFit() | Out-Null
  # Cap very wide columns
  for ($c = 1; $c -le $headers.Count; $c++) {
    if ($ws.Columns.Item($c).ColumnWidth -gt 60) { $ws.Columns.Item($c).ColumnWidth = 60 }
  }
  $used.VerticalAlignment = -4160  # xlTop

  if (Test-Path $xlsx) { Remove-Item $xlsx -Force }
  $wb.SaveAs($xlsx, 51)  # xlOpenXMLWorkbook
  $wb.Close($false)
  Write-Output ("Wrote {0} rows to {1}" -f $rows.Count, $xlsx)
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
