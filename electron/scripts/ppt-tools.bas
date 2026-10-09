Attribute VB_Name = "AudioTools"

Private Const MEDIA_PLAY_EFFECT As Long = 83
Private Const SECTION_AUDIO_PREFIX As String = "ppt_audio_"

' ==============================================================================================
' INSTRUCTIONS FOR USER:
' 1. Open PowerPoint.
' 2. Press Alt+F11 (or Fn+Opt+F11 on Mac) to open the VBA Editor.
' 3. File -> Remove Module (if previous one exists).
' 4. File -> Import File... -> Select this NEW "InsertAudio.bas" file.
' 5. Go to File -> Save As... -> Save as PowerPoint Add-in (.ppam) -> Overwrite previous "AudioTools.ppam".
' 6. Restart PowerPoint to ensure the new Add-in is loaded.
' ==============================================================================================

Function GetPresentation(targetPath As String) As Presentation
    Dim p As Presentation
    Dim targetName As String
    Set GetPresentation = Nothing
    
    For Each p In Application.Presentations
        If p.FullName = targetPath Or p.Name = Dir(targetPath) Then
            Set GetPresentation = p
            Exit Function
        End If
    Next p
    
    targetName = Mid(targetPath, InStrRev(targetPath, "/") + 1)
    For Each p In Application.Presentations
        If p.Name = targetName Then
            Set GetPresentation = p
            Exit Function
        End If
    Next p
End Function

Function GetOfficeContainerPath() As String
    GetOfficeContainerPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office"
End Function

Function GetOfficeFilePath(fileName As String) As String
    GetOfficeFilePath = GetOfficeContainerPath() & "/" & fileName
End Function

Function ReadSingleLineFile(filePath As String, missingMessage As String) As String
    Dim fileNum As Integer

    If Dir(filePath) = "" Then
        MsgBox missingMessage
        ReadSingleLineFile = ""
        Exit Function
    End If

    fileNum = FreeFile
    Open filePath For Input As fileNum
    Line Input #fileNum, ReadSingleLineFile
    Close fileNum
End Function

Function GetPresentationOrShowError(targetPath As String) As Presentation
    Set GetPresentationOrShowError = GetPresentation(targetPath)

    If GetPresentationOrShowError Is Nothing Then
        MsgBox "Error: Presentation not found: " & targetPath
    End If
End Function

Function IsManagedAudioShapeName(shapeName As String) As Boolean
    IsManagedAudioShapeName = InStr(1, shapeName, "ppt_audio") = 1
End Function

Function GetSlideNotesText(sld As Slide) As String
    On Error GoTo EmptyNotes

    If sld.NotesPage.Shapes.Count > 1 Then
        GetSlideNotesText = sld.NotesPage.Shapes(2).TextFrame.TextRange.Text
        Exit Function
    End If

EmptyNotes:
    GetSlideNotesText = ""
End Function

Sub WriteSlideNotesBlock(fileNum As Integer, slideIndex As Integer, notesText As String)
    Dim normalizedText As String
    Dim lines() As String
    Dim i As Long

    Print #fileNum, "###SLIDE_START### " & slideIndex

    normalizedText = Replace(notesText, vbCrLf, vbLf)
    normalizedText = Replace(normalizedText, vbCr, vbLf)

    If Len(normalizedText) > 0 Then
        lines = Split(normalizedText, vbLf)
        For i = LBound(lines) To UBound(lines)
            Print #fileNum, lines(i)
        Next i
    End If

    Print #fileNum, "###SLIDE_END###"
End Sub

Sub ExportNotesToFile(pres As Presentation, outputPath As String, Optional slideIndex As Integer = 0)
    Dim outputNum As Integer
    Dim i As Integer

    outputNum = FreeFile
    Open outputPath For Output As outputNum

    If slideIndex > 0 Then
        WriteSlideNotesBlock outputNum, slideIndex, GetSlideNotesText(pres.Slides(slideIndex))
    Else
        For i = 1 To pres.Slides.Count
            WriteSlideNotesBlock outputNum, i, GetSlideNotesText(pres.Slides(i))
        Next i
    End If

    Close outputNum
End Sub

Function GetSectionIndex(audioTag As String) As Integer
    ' Expects the managed audio tag format "ppt_audio_<section>"
    Dim parts() As String
    On Error Resume Next
    parts = Split(audioTag, "_")
    If UBound(parts) >= 2 Then
        GetSectionIndex = CInt(parts(2))
    Else
        GetSectionIndex = 1
    End If
    If Err.Number <> 0 Then
        GetSectionIndex = 1
        Err.Clear
    End If
    On Error GoTo 0
End Function

Function IsSectionAudioShape(s As Shape) As Boolean
    Dim ordinal As String

    If s.Type <> msoMedia Then Exit Function
    If InStr(1, s.Name, SECTION_AUDIO_PREFIX) <> 1 Then Exit Function

    ordinal = Mid(s.Name, Len(SECTION_AUDIO_PREFIX) + 1)
    IsSectionAudioShape = Len(ordinal) > 0 And Not ordinal Like "*[!0-9]*"
End Function

Function ListSectionAudio(sld As Slide) As String
    Dim s As Shape

    For Each s In sld.Shapes
        If IsSectionAudioShape(s) Then
            If Len(ListSectionAudio) > 0 Then ListSectionAudio = ListSectionAudio & ","
            ListSectionAudio = ListSectionAudio & s.Name
        End If
    Next s
End Function

Function IsRequestedSectionAudio(slideNumber As Integer, shapeName As String, slideNumbers() As Integer, shapeNames() As String, entryCount As Integer) As Boolean
    Dim i As Integer

    For i = 1 To entryCount
        If slideNumbers(i) = slideNumber And shapeNames(i) = shapeName Then
            IsRequestedSectionAudio = True
            Exit Function
        End If
    Next i
End Function

Function IsFirstEntryForSlide(slideNumbers() As Integer, entry As Integer) As Boolean
    Dim i As Integer

    For i = 1 To entry - 1
        If slideNumbers(i) = slideNumbers(entry) Then Exit Function
    Next i
    IsFirstEntryForSlide = True
End Function

Sub RemoveObsoleteSectionAudio(sld As Slide, slideNumber As Integer, slideNumbers() As Integer, shapeNames() As String, entryCount As Integer)
    Dim iShape As Integer
    Dim s As Shape

    For iShape = sld.Shapes.Count To 1 Step -1
        Set s = sld.Shapes(iShape)
        If IsSectionAudioShape(s) Then
            If Not IsRequestedSectionAudio(slideNumber, s.Name, slideNumbers, shapeNames, entryCount) Then
                s.Delete
            End If
        End If
    Next iShape
End Sub

Function ReplaceSectionAudio(pres As Presentation, sld As Slide, audioPath As String, audioTag As String, newAudioInsertIndex As Integer) As Shape
    Dim shp As Shape
    Dim s As Shape
    Dim eff As Effect
    Dim iShape As Integer
    Dim effIdx As Integer
    Dim i As Integer
    Dim margin As Single
    Dim sectionIdx As Integer
    Dim hadExistingAudio As Boolean
    Dim existingAnimIndex As Integer
    Dim existingTriggerType As Integer
    Dim existingDelay As Single
    Dim existingRepeatCount As Long
    Dim existingRepeatDuration As Single
    Dim existingRewindAtEnd As MsoTriState

    hadExistingAudio = False
    existingAnimIndex = 1
    existingTriggerType = 3 ' 3 = msoAnimTriggerAfterPrevious
    existingDelay = 0
    existingRepeatCount = 1
    existingRepeatDuration = 0
    existingRewindAtEnd = msoFalse

    ' Find and delete existing audio from our tool, but save its animation properties first
    For iShape = sld.Shapes.Count To 1 Step -1
        Set s = sld.Shapes(iShape)
        If s.Name = audioTag Then
            For effIdx = 1 To sld.TimeLine.MainSequence.Count
                If Not sld.TimeLine.MainSequence(effIdx).Shape Is Nothing Then
                    If sld.TimeLine.MainSequence(effIdx).Shape.Name = audioTag Then
                        hadExistingAudio = True
                        existingAnimIndex = effIdx
                        existingTriggerType = sld.TimeLine.MainSequence(effIdx).Timing.TriggerType
                        existingDelay = sld.TimeLine.MainSequence(effIdx).Timing.TriggerDelayTime
                        existingRepeatCount = sld.TimeLine.MainSequence(effIdx).Timing.RepeatCount
                        existingRepeatDuration = sld.TimeLine.MainSequence(effIdx).Timing.RepeatDuration
                        existingRewindAtEnd = sld.TimeLine.MainSequence(effIdx).Timing.RewindAtEnd
                        Exit For
                    End If
                End If
            Next effIdx
            s.Delete
        End If
    Next iShape

    Set shp = sld.Shapes.AddMediaObject2(audioPath, 0, -1, 10, 10)
    If shp Is Nothing Then
        Err.Raise vbObjectError + 513, , "Could not insert " & audioTag & " on slide " & sld.SlideIndex & "."
    End If

    shp.Name = audioTag

    margin = 20

    ' Calculate vertical position based on section index to avoid stacking
    sectionIdx = GetSectionIndex(audioTag)

    shp.Left = pres.PageSetup.SlideWidth + margin

    shp.Top = margin + (sectionIdx - 1) * (shp.Height + margin)

    For i = sld.TimeLine.MainSequence.Count To 1 Step -1
        If Not sld.TimeLine.MainSequence(i).Shape Is Nothing Then
            If sld.TimeLine.MainSequence(i).Shape.Name = shp.Name Then
                sld.TimeLine.MainSequence(i).Delete
            End If
        End If
    Next i

    Set eff = sld.TimeLine.MainSequence.AddEffect(shp, MEDIA_PLAY_EFFECT, , existingTriggerType)

    If hadExistingAudio Then
        eff.Timing.TriggerDelayTime = existingDelay
        eff.Timing.RepeatCount = existingRepeatCount
        eff.Timing.RepeatDuration = existingRepeatDuration
        eff.Timing.RewindAtEnd = existingRewindAtEnd
    End If

    If hadExistingAudio Then
        If existingAnimIndex <= sld.TimeLine.MainSequence.Count And existingAnimIndex > 0 Then
            eff.MoveTo existingAnimIndex
            newAudioInsertIndex = existingAnimIndex + 1
        End If
    Else
        ' Insert audio to the FRONT of the powerpoint sequentially
        If sld.TimeLine.MainSequence.Count >= newAudioInsertIndex Then
            eff.MoveTo newAudioInsertIndex
        End If
        newAudioInsertIndex = newAudioInsertIndex + 1
    End If

    With shp.MediaFormat
        .Muted = False
        .Volume = 0.5
    End With

    Set ReplaceSectionAudio = shp
End Function

' Params: a "presentation|result path" header, then one "slide number|audio path" line per section audio.
' The audio lines for a slide are its complete section audio; any other section audio on it is obsolete.
' The result file gets "inserted|slide|shape" per section audio, "slide|slide|shapes" listing the section
' audio left on each saved slide, "error|message" on failure, and "done" once the presentation is saved.
Sub InsertAudio()
    Dim pres As Presentation
    Dim sld As Slide
    Dim shp As Shape
    Dim paramsPath As String
    Dim paramsNum As Integer
    Dim resultNum As Integer
    Dim fileContent As String
    Dim header() As String
    Dim params() As String
    Dim slideNumbers() As Integer
    Dim audioPaths() As String
    Dim shapeNames() As String
    Dim entryCount As Integer
    Dim fileName As String
    Dim currentSlideNumber As Integer
    Dim newAudioInsertIndex As Integer
    Dim i As Integer

    paramsPath = GetOfficeFilePath("insert_audio_params.txt")
    If Dir(paramsPath) = "" Then Exit Sub

    paramsNum = FreeFile
    Open paramsPath For Input As paramsNum
    If EOF(paramsNum) Then
        Close paramsNum
        Exit Sub
    End If
    Line Input #paramsNum, fileContent
    header = Split(fileContent, "|")
    If UBound(header) < 1 Then
        Close paramsNum
        Exit Sub
    End If

    resultNum = FreeFile
    Open header(1) For Output As resultNum
    On Error GoTo Failed

    entryCount = 0
    Do While Not EOF(paramsNum)
        Line Input #paramsNum, fileContent
        If Len(Trim(fileContent)) > 0 Then
            params = Split(fileContent, "|")
            If UBound(params) < 1 Then
                Err.Raise vbObjectError + 514, , "Malformed audio line: " & fileContent
            End If

            entryCount = entryCount + 1
            ReDim Preserve slideNumbers(1 To entryCount)
            ReDim Preserve audioPaths(1 To entryCount)
            ReDim Preserve shapeNames(1 To entryCount)

            slideNumbers(entryCount) = CInt(params(0))
            audioPaths(entryCount) = params(1)
            ' Managed audio filenames and shape names follow "ppt_audio_<section>"
            fileName = Mid(params(1), InStrRev(params(1), "/") + 1)
            shapeNames(entryCount) = Left(fileName, InStrRev(fileName, ".") - 1)
        End If
    Loop
    Close paramsNum
    paramsNum = 0

    Set pres = GetPresentation(header(0))
    If pres Is Nothing Then
        Err.Raise vbObjectError + 515, , "Presentation not found: " & header(0)
    End If

    currentSlideNumber = 0
    For i = 1 To entryCount
        If slideNumbers(i) < 1 Or slideNumbers(i) > pres.Slides.Count Then
            Err.Raise vbObjectError + 516, , "Slide " & slideNumbers(i) & " does not exist."
        End If

        If slideNumbers(i) <> currentSlideNumber Then
            currentSlideNumber = slideNumbers(i)
            newAudioInsertIndex = 1
        End If

        Set shp = ReplaceSectionAudio(pres, pres.Slides(slideNumbers(i)), audioPaths(i), shapeNames(i), newAudioInsertIndex)
        Print #resultNum, "inserted|" & slideNumbers(i) & "|" & shp.Name
    Next i

    ' Only once every replacement has captured its old animation is obsolete audio removed
    For i = 1 To entryCount
        If IsFirstEntryForSlide(slideNumbers, i) Then
            Set sld = pres.Slides(slideNumbers(i))
            RemoveObsoleteSectionAudio sld, slideNumbers(i), slideNumbers, shapeNames, entryCount
            Print #resultNum, "slide|" & slideNumbers(i) & "|" & ListSectionAudio(sld)
        End If
    Next i

    pres.Save
    Print #resultNum, "done"
    Close resultNum
    Exit Sub

Failed:
    Print #resultNum, "error|" & Replace(Replace(Err.Description, vbCr, " "), vbLf, " ")
    Close resultNum
    If paramsNum <> 0 Then Close paramsNum
End Sub

Sub ExportAllSlideNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim outputPath As String
    Dim targetPath As String
    Dim fileContent As String
    Dim params() As String

    paramsPath = GetOfficeFilePath("export_all_notes_params.txt")
    fileContent = ReadSingleLineFile(paramsPath, "Error: Could not find export_all_notes_params.txt")
    If fileContent = "" Then Exit Sub

    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub

    targetPath = params(0)
    outputPath = params(1)

    Set pres = GetPresentationOrShowError(targetPath)
    If pres Is Nothing Then Exit Sub

    ExportNotesToFile pres, outputPath
End Sub

Sub ExportSlideNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim outputPath As String
    Dim targetPath As String
    Dim fileContent As String
    Dim params() As String
    Dim slideIndex As Integer

    paramsPath = GetOfficeFilePath("export_slide_notes_params.txt")
    fileContent = ReadSingleLineFile(paramsPath, "Error: Could not find export_slide_notes_params.txt")
    If fileContent = "" Then Exit Sub

    params = Split(fileContent, "|")
    If UBound(params) < 2 Then Exit Sub

    targetPath = params(0)
    slideIndex = CInt(params(1))
    outputPath = params(2)

    Set pres = GetPresentationOrShowError(targetPath)
    If pres Is Nothing Then Exit Sub

    If slideIndex < 1 Or slideIndex > pres.Slides.Count Then
        MsgBox "Invalid slide index: " & slideIndex
        Exit Sub
    End If

    ExportNotesToFile pres, outputPath, slideIndex
End Sub

Function IsSectionAudioShapeName(shapeName As String) As Boolean
    ' Section audio is named exactly "ppt_audio_<1-based section ordinal>"
    Dim ordinal As String
    Dim i As Long

    IsSectionAudioShapeName = False
    If InStr(1, shapeName, "ppt_audio_") <> 1 Then Exit Function

    ordinal = Mid(shapeName, Len("ppt_audio_") + 1)
    If Len(ordinal) = 0 Or Left(ordinal, 1) = "0" Then Exit Function

    For i = 1 To Len(ordinal)
        If Mid(ordinal, i, 1) < "0" Or Mid(ordinal, i, 1) > "9" Then Exit Function
    Next i

    IsSectionAudioShapeName = True
End Function

Sub WriteInspectionError(outputPath As String, message As String)
    Dim fileNum As Integer

    fileNum = FreeFile
    Open outputPath For Output As fileNum
    Print #fileNum, "###ERROR### " & message
    Close fileNum
End Sub

Sub ExportSectionAudioPlayback()
    ' Reports every section audio shape on the requested slides as
    ' "name<TAB>kind<TAB>StopAfterSlides", ending with ###EXPORT_COMPLETE###.
    ' Any failure replaces the report with a single ###ERROR### line.
    Dim pres As Presentation
    Dim sld As Slide
    Dim shp As Shape
    Dim paramsPath As String
    Dim outputPath As String
    Dim fileContent As String
    Dim params() As String
    Dim slideNumbers() As String
    Dim slideNumber As Long
    Dim i As Long
    Dim outputNum As Integer
    Dim kind As String
    Dim stopAfterSlides As String
    Dim context As String
    Dim errorMessage As String

    paramsPath = GetOfficeFilePath("export_audio_playback_params.txt")
    fileContent = ReadSingleLineFile(paramsPath, "Error: Could not find export_audio_playback_params.txt")
    If fileContent = "" Then Exit Sub

    params = Split(fileContent, "|")
    If UBound(params) < 2 Then Exit Sub
    outputPath = params(2)

    On Error GoTo InspectionFailed

    context = "Could not find the presentation " & params(0)
    Set pres = GetPresentation(params(0))
    If pres Is Nothing Then
        WriteInspectionError outputPath, "Presentation not found: " & params(0)
        Exit Sub
    End If

    outputNum = FreeFile
    Open outputPath For Output As outputNum

    slideNumbers = Split(params(1), ",")
    For i = LBound(slideNumbers) To UBound(slideNumbers)
        context = "Could not inspect slide " & slideNumbers(i)
        slideNumber = CLng(slideNumbers(i))
        If slideNumber < 1 Or slideNumber > pres.Slides.Count Then
            errorMessage = "Invalid slide number: " & slideNumber
            GoTo ReportFailure
        End If

        Set sld = pres.Slides(slideNumber)
        Print #outputNum, "###SLIDE_START### " & slideNumber

        For Each shp In sld.Shapes
            If IsSectionAudioShapeName(shp.Name) Then
                context = "Could not read the playback of " & shp.Name & " on slide " & slideNumber
                kind = "other"
                stopAfterSlides = ""

                If shp.Type = msoMedia Then
                    If shp.MediaType = ppMediaTypeSound Then
                        kind = "sound"
                        stopAfterSlides = CStr(shp.AnimationSettings.PlaySettings.StopAfterSlides)
                    End If
                End If

                Print #outputNum, shp.Name & vbTab & kind & vbTab & stopAfterSlides
            End If
        Next shp

        Print #outputNum, "###SLIDE_END###"
    Next i

    Print #outputNum, "###EXPORT_COMPLETE###"
    Close outputNum
    Exit Sub

InspectionFailed:
    errorMessage = context & ": " & Err.Description
    Resume ReportFailure

ReportFailure:
    On Error Resume Next
    If outputNum <> 0 Then Close outputNum
    WriteInspectionError outputPath, errorMessage
End Sub

Sub UpdateNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim dataPath As String
    Dim targetPath As String
    Dim fileContent As String
    Dim params() As String
    Dim dataNum As Integer
    Dim lineData As String
    Dim currentSlideIndex As Integer
    Dim currentNotes As String
    Dim isReadingNotes As Boolean
    Dim isFirstLine As Boolean
    
    paramsPath = GetOfficeFilePath("update_notes_params.txt")
    fileContent = ReadSingleLineFile(paramsPath, "Error: Could not find update_notes_params.txt")
    If fileContent = "" Then Exit Sub
    
    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub
    
    targetPath = params(0)
    dataPath = params(1)
    
    Set pres = GetPresentationOrShowError(targetPath)
    If pres Is Nothing Then Exit Sub
    
    If Dir(dataPath) = "" Then
        MsgBox "Error: Data file not found: " & dataPath
        Exit Sub
    End If
    
    
    currentSlideIndex = -1
    isReadingNotes = False
    
    dataNum = FreeFile
    Open dataPath For Input As dataNum
    
    isReadingNotes = False
    
    Do While Not EOF(dataNum)
        Line Input #dataNum, lineData
        
        If Left(lineData, 17) = "###SLIDE_START###" Then
            currentSlideIndex = CInt(Mid(lineData, 19))
            currentNotes = ""
            isReadingNotes = True
            isFirstLine = True
        ElseIf Left(lineData, 15) = "###SLIDE_END###" Then
            If currentSlideIndex > 0 And currentSlideIndex <= pres.Slides.Count Then
                On Error Resume Next
                pres.Slides(currentSlideIndex).NotesPage.Shapes(2).TextFrame.TextRange.Text = currentNotes
                On Error GoTo 0
            End If
            isReadingNotes = False
        Else
            If isReadingNotes Then
                If isFirstLine Then
                    currentNotes = lineData
                    isFirstLine = False
                Else
                    currentNotes = currentNotes & vbLf & lineData
                End If
            End If
        End If
    Loop
    
    Close dataNum
    
    pres.Save
    ' pres.Close
    
End Sub

Sub RemoveAudio()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim fileContent As String
    Dim params() As String
    Dim slideIndices() As String
    Dim targetPath As String
    Dim slideIndex As Integer
    Dim sld As Slide
    Dim s As Shape
    Dim iShape As Integer
    Dim i As Integer
    
    paramsPath = GetOfficeFilePath("remove_audio_params.txt")
    fileContent = ReadSingleLineFile(paramsPath, "Error: Could not find remove_audio_params.txt")
    If fileContent = "" Then Exit Sub
    
    ' Format: TargetPath|SlideIndex1,SlideIndex2,...
    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub
    
    targetPath = params(0)
    slideIndices = Split(params(1), ",")
    
    Set pres = GetPresentationOrShowError(targetPath)
    If pres Is Nothing Then Exit Sub
    
    For i = LBound(slideIndices) To UBound(slideIndices)
        If Len(Trim(slideIndices(i))) > 0 Then
            slideIndex = CInt(Trim(slideIndices(i)))
            If slideIndex > 0 And slideIndex <= pres.Slides.Count Then
                Set sld = pres.Slides(slideIndex)
                For iShape = sld.Shapes.Count To 1 Step -1
                    Set s = sld.Shapes(iShape)
                    If IsManagedAudioShapeName(s.Name) Then
                        s.Delete
                    End If
                Next iShape
            End If
        End If
    Next i
    
    pres.Save
End Sub
