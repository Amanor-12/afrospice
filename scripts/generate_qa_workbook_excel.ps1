$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$json = & python "$repoRoot\scripts\generate_qa_workbook.py" --json
if (-not $json) {
  throw "Failed to read workbook definition from Python generator."
}

Add-Type -AssemblyName System.Web.Extensions
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = 67108864
$definition = $serializer.DeserializeObject($json)
$outputPath = $definition["output_path"]

$xlExpression = 2
$xlValidateList = 3
$xlCellValue = 1
$xlBetween = 1
$xlOpenXMLWorkbook = 51

function Set-DxfStyle {
  param(
    $formatCondition,
    [int]$dxfId
  )

  switch ($dxfId) {
    0 {
      $formatCondition.Interior.Color = 14935011
      $formatCondition.Font.Color = 61184
      $formatCondition.Font.Bold = $true
    }
    1 {
      $formatCondition.Interior.Color = 14803425
      $formatCondition.Font.Color = 1776411
      $formatCondition.Font.Bold = $true
    }
    2 {
      $formatCondition.Interior.Color = 13303756
      $formatCondition.Font.Color = 9486350
      $formatCondition.Font.Bold = $true
    }
    3 {
      $formatCondition.Interior.Color = 15724527
      $formatCondition.Font.Color = 7566195
      $formatCondition.Font.Bold = $true
    }
    4 {
      $formatCondition.Interior.Color = 16706413
      $formatCondition.Font.Color = 1381653
      $formatCondition.Font.Bold = $true
    }
    5 {
      $formatCondition.Interior.Color = 9109504
      $formatCondition.Font.Color = 9486350
      $formatCondition.Font.Bold = $true
    }
    6 {
      $formatCondition.Interior.Color = 14935011
      $formatCondition.Font.Color = 662143
      $formatCondition.Font.Bold = $true
    }
    7 {
      $formatCondition.Interior.Color = 15132390
      $formatCondition.Font.Color = 6513507
      $formatCondition.Font.Bold = $true
    }
  }
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $workbook = $excel.Workbooks.Add()
  while ($workbook.Worksheets.Count -lt $definition["sheets"].Count) {
    $null = $workbook.Worksheets.Add()
  }
  while ($workbook.Worksheets.Count -gt $definition["sheets"].Count) {
    $workbook.Worksheets.Item($workbook.Worksheets.Count).Delete()
  }

  for ($sheetIndex = 0; $sheetIndex -lt $definition["sheets"].Count; $sheetIndex++) {
    $sheetDef = $definition["sheets"][$sheetIndex]
    $worksheet = $workbook.Worksheets.Item($sheetIndex + 1)
    $worksheet.Name = $sheetDef["name"]

    $rowCount = $sheetDef["rows"].Count
    $colCount = $sheetDef["columns"].Count
    $data = New-Object 'object[,]' $rowCount, $colCount

    for ($row = 0; $row -lt $rowCount; $row++) {
      for ($col = 0; $col -lt $colCount; $col++) {
        $data[$row, $col] = [string]$sheetDef["rows"][$row][$col]
      }
    }

    $start = $worksheet.Cells.Item(1, 1)
    $finish = $worksheet.Cells.Item($rowCount, $colCount)
    $range = $worksheet.Range($start, $finish)
    $range.Value2 = $data
    $range.WrapText = $true
    $range.VerticalAlignment = -4160

    $headerRange = $worksheet.Range($worksheet.Cells.Item(1, 1), $worksheet.Cells.Item(1, $colCount))
    $headerRange.Font.Bold = $true
    $headerRange.Font.Color = 16777215
    $headerRange.Interior.Color = 1381653
    $headerRange.RowHeight = 28
    $headerRange.HorizontalAlignment = -4108

    for ($col = 0; $col -lt $colCount; $col++) {
      $worksheet.Columns.Item($col + 1).ColumnWidth = [double]$sheetDef["columns"][$col]["width"]
    }

    $usedRange = $worksheet.UsedRange
    $usedRange.Borders.LineStyle = 1
    $usedRange.Borders.Color = 15724527
    $usedRange.Rows.AutoFit() | Out-Null
    $worksheet.Rows.Item(1).RowHeight = 28

    $usedRange.AutoFilter() | Out-Null

    foreach ($validation in $sheetDef["validations"]) {
      $validationRange = $worksheet.Range($validation["range"])
      $validationRange.Validation.Delete()
      $validationRange.Validation.Add($xlValidateList, $xlCellValue, $xlBetween, $validation["formula"]) | Out-Null
      $validationRange.Validation.IgnoreBlank = $true
      $validationRange.Validation.InCellDropdown = $true
    }

    foreach ($formatGroup in $sheetDef["conditional_formats"]) {
      $formatRange = $worksheet.Range($formatGroup["range"])
      $formatRange.FormatConditions.Delete()
      foreach ($rule in $formatGroup["rules"]) {
        $condition = $formatRange.FormatConditions.Add($xlExpression, $null, "=" + $rule["formula"])
        Set-DxfStyle -formatCondition $condition -dxfId ([int]$rule["dxfId"])
      }
    }

    $worksheet.Activate() | Out-Null
    $excel.ActiveWindow.SplitRow = 1
    $excel.ActiveWindow.FreezePanes = $true
  }

  $targetDir = Split-Path -Parent $outputPath
  if (-not (Test-Path $targetDir)) {
    $null = New-Item -ItemType Directory -Path $targetDir -Force
  }

  $workbook.SaveAs($outputPath, $xlOpenXMLWorkbook)
  $workbook.Close($false)
  Write-Output "Wrote $outputPath"
}
finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
