Attribute VB_Name = "AudioTools"

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

Sub InsertAudio()
    Dim sld As Slide
    Dim shp As Shape
    Dim pres As Presentation
    Dim paramsPath As String
    Dim fileNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim slideIndex As Integer
    Dim audioPath As String
    Dim currentSlideIndex As Integer
    Dim newAudioInsertIndex As Integer
    Dim targetPath As String
    Dim hasPres As Boolean
    Dim audioTag As String
    Dim fileName As String
    Dim hadExistingAudio As Boolean
    Dim existingAnimIndex As Integer
    Dim existingTriggerType As Integer
    Dim existingDelay As Single
    Dim existingRepeatCount As Long
    Dim existingRepeatDuration As Single
    Dim existingRewindAtEnd As MsoTriState
    Dim s As Shape
    Dim iShape As Integer
    Dim effIdx As Integer
    Dim margin As Single
    Dim audioCount As Integer
    Dim tempShape As Shape
    Dim eff As Effect
    Dim i As Integer
    
    currentSlideIndex = 0
    newAudioInsertIndex = 1
    
    ' Path construction for Mac Office sandbox
    paramsPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office/insert_audio_params.txt"
    
    If Dir(paramsPath) = "" Then
        MsgBox "Error: Could not find insert_audio_params.txt at " & paramsPath
        Exit Sub
    End If
    
    ' Batch Process Mode
    
    hasPres = False
    
    fileNum = FreeFile
    Open paramsPath For Input As fileNum
    
    Do While Not EOF(fileNum)
        Line Input #fileNum, fileContent
        
        If Len(Trim(fileContent)) > 0 Then
            params = Split(fileContent, "|")
            
            If UBound(params) >= 2 Then
                targetPath = params(0)
                slideIndex = CInt(params(1))
                audioPath = params(2)
                
                ' Only find presentation once (on first valid line)
                If Not hasPres Then
                    ' Find the correct presentation
                    Set pres = GetPresentation(targetPath)
                    
                    If pres Is Nothing Then
                        MsgBox "Error: Could not find open presentation: " & targetPath
                        Close fileNum
                        Exit Sub
                    End If
                    
                    hasPres = True
                End If
                
                ' Process Audio Insertion for this line
                If slideIndex > 0 And slideIndex <= pres.Slides.Count Then
                    Set sld = pres.Slides(slideIndex)
                    
                    If slideIndex <> currentSlideIndex Then
                        currentSlideIndex = slideIndex
                        newAudioInsertIndex = 1
                    End If
                    
                    ' Tag for unique identification
                    fileName = Mid(audioPath, InStrRev(audioPath, "/") + 1)
                    fileName = Left(fileName, InStrRev(fileName, ".") - 1)
                    audioTag = fileName
                    
                    ' Variables to preserve animation state
                    
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
                            ' Find its effect in MainSequence to copy properties
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
                    
                    ' Insert the audio object
                    Set shp = sld.Shapes.AddMediaObject2(audioPath, 0, -1, 10, 10)
                    
                    If Not shp Is Nothing Then
                        shp.Name = audioTag
                        
                        margin = 10
                        audioCount = 0
                        
                        ' Count existing audio shapes to determine vertical stack position
                        For Each tempShape In sld.Shapes
                            If InStr(1, tempShape.Name, "ppt_audio") = 1 Then
                                audioCount = audioCount + 1
                            End If
                        Next tempShape
                        
                        ' Position on the right using SlideWidth and native shape Width
                        shp.Left = pres.PageSetup.SlideWidth + margin
                        
                        ' Prevent stacking by spacing them vertically using their native Height
                        ' (audioCount includes the newly added shape, so subtract 1)
                        shp.Top = margin + (audioCount - 1) * (shp.Height + margin)
                        
                        ' --- Animation Configuration ---
                        
                        ' 1. Ensure clean slate (remove any auto-added effects for this shape)
                        For i = sld.TimeLine.MainSequence.Count To 1 Step -1
                            If Not sld.TimeLine.MainSequence(i).Shape Is Nothing Then
                                If sld.TimeLine.MainSequence(i).Shape.Name = shp.Name Then
                                    sld.TimeLine.MainSequence(i).Delete
                                End If
                            End If
                        Next i
                        
                        ' 2. Add "Play" effect to Main Sequence with preserved TriggerType
                        Set eff = sld.TimeLine.MainSequence.AddEffect(shp, 83, , existingTriggerType) 
                        
                        ' 3. Apply preserved delay
                        If hadExistingAudio Then
                            eff.Timing.TriggerDelayTime = existingDelay
                            eff.Timing.RepeatCount = existingRepeatCount
                            eff.Timing.RepeatDuration = existingRepeatDuration
                            eff.Timing.RewindAtEnd = existingRewindAtEnd
                        End If
                        
                        ' 4. Move to appropriate position
                        If hadExistingAudio Then
                            ' Move to previous index if valid.
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
                    End If
                End If
            End If
        End If
    Loop
    
    Close fileNum
    
    ' Save ONCE after batch processing
    If hasPres Then
        pres.Save
    End If
    
End Sub

Sub ExportAllSlideNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim outputPath As String
    Dim targetPath As String
    Dim fileNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim outputNum As Integer
    Dim i As Integer

    paramsPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office/export_all_notes_params.txt"

    If Dir(paramsPath) = "" Then
        MsgBox "Error: Could not find export_all_notes_params.txt"
        Exit Sub
    End If

    fileNum = FreeFile
    Open paramsPath For Input As fileNum
    Line Input #fileNum, fileContent
    Close fileNum

    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub

    targetPath = params(0)
    outputPath = params(1)

    Set pres = GetPresentation(targetPath)

    If pres Is Nothing Then
        MsgBox "Error: Presentation not found: " & targetPath
        Exit Sub
    End If

    outputNum = FreeFile
    Open outputPath For Output As outputNum

    For i = 1 To pres.Slides.Count
        WriteSlideNotesBlock outputNum, i, GetSlideNotesText(pres.Slides(i))
    Next i

    Close outputNum
End Sub

Sub ExportSlideNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim outputPath As String
    Dim targetPath As String
    Dim fileNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim outputNum As Integer
    Dim slideIndex As Integer

    paramsPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office/export_slide_notes_params.txt"

    If Dir(paramsPath) = "" Then
        MsgBox "Error: Could not find export_slide_notes_params.txt"
        Exit Sub
    End If

    fileNum = FreeFile
    Open paramsPath For Input As fileNum
    Line Input #fileNum, fileContent
    Close fileNum

    params = Split(fileContent, "|")
    If UBound(params) < 2 Then Exit Sub

    targetPath = params(0)
    slideIndex = CInt(params(1))
    outputPath = params(2)

    Set pres = GetPresentation(targetPath)

    If pres Is Nothing Then
        MsgBox "Error: Presentation not found: " & targetPath
        Exit Sub
    End If

    If slideIndex < 1 Or slideIndex > pres.Slides.Count Then
        MsgBox "Invalid slide index: " & slideIndex
        Exit Sub
    End If

    outputNum = FreeFile
    Open outputPath For Output As outputNum
    WriteSlideNotesBlock outputNum, slideIndex, GetSlideNotesText(pres.Slides(slideIndex))
    Close outputNum
End Sub

Sub UpdateNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim dataPath As String
    Dim targetPath As String
    Dim fileNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim dataNum As Integer
    Dim lineData As String
    Dim currentSlideIndex As Integer
    Dim currentNotes As String
    Dim isReadingNotes As Boolean
    
    ' 1. Read Parameters (Presentation Path | Data File Path)
    paramsPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office/update_notes_params.txt"
    
    If Dir(paramsPath) = "" Then
        MsgBox "Error: Could not find update_notes_params.txt"
        Exit Sub
    End If
    
    fileNum = FreeFile
    Open paramsPath For Input As fileNum
    Line Input #fileNum, fileContent
    Close fileNum
    
    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub
    
    targetPath = params(0)
    dataPath = params(1)
    
    ' 2. Find Presentation
    Set pres = GetPresentation(targetPath)
    
    If pres Is Nothing Then
        MsgBox "Error: Presentation not found: " & targetPath
        Exit Sub
    End If
    
    ' 3. Read Data File
    If Dir(dataPath) = "" Then
        MsgBox "Error: Data file not found: " & dataPath
        Exit Sub
    End If
    
    
    currentSlideIndex = -1
    isReadingNotes = False
    
    dataNum = FreeFile
    Open dataPath For Input As dataNum
    
    Do While Not EOF(dataNum)
        Line Input #dataNum, lineData
        
        If Left(lineData, 17) = "###SLIDE_START###" Then
            ' Format: ###SLIDE_START### <index>
            currentSlideIndex = CInt(Mid(lineData, 19))
            currentNotes = ""
            isReadingNotes = True
        ElseIf Left(lineData, 15) = "###SLIDE_END###" Then
            If currentSlideIndex > 0 And currentSlideIndex <= pres.Slides.Count Then
                ' Apply notes to slide
                On Error Resume Next
                pres.Slides(currentSlideIndex).NotesPage.Shapes(2).TextFrame.TextRange.Text = currentNotes
                On Error GoTo 0
            End If
            isReadingNotes = False
        Else
            If isReadingNotes Then
                If currentNotes = "" Then
                    currentNotes = lineData
                Else
                    currentNotes = currentNotes & vbCrLf & lineData
                End If
            End If
        End If
    Loop
    
    Close dataNum
    
    ' 4. Save
    pres.Save
    ' pres.Close
    
End Sub

Sub PlaySlide()
    Dim targetPath As String
    Dim pres As Presentation
    Dim slideIndex As Integer
    Dim paramsPath As String
    Dim fileNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim i As Integer
    Dim sw As SlideShowWindow
    
    ' 1. Read parameters (TargetPath | SlideIndex)
    paramsPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office/play_slide_params.txt"
    
    If Dir(paramsPath) = "" Then
        MsgBox "Error: Could not find play_slide_params.txt"
        Exit Sub
    End If
    
    fileNum = FreeFile
    Open paramsPath For Input As fileNum
    Line Input #fileNum, fileContent
    Close fileNum
    
    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub
    
    targetPath = params(0)
    slideIndex = CInt(Trim(params(1)))
    
    ' 2. Find Presentation
    Set pres = GetPresentation(targetPath)
    
    If pres Is Nothing Then
        MsgBox "Error: Presentation not found: " & targetPath
        Exit Sub
    End If
    
    ' 3. Validate Index
    If slideIndex < 1 Or slideIndex > pres.Slides.Count Then
        MsgBox "Invalid slide index: " & slideIndex
        Exit Sub
    End If
    
    ' 4. Start Slide Show
    With pres.SlideShowSettings
        .RangeType = ppShowAll
        .AdvanceMode = ppSlideShowUseSlideTimings
        .Run
    End With
    
    ' 5. Navigate to Slide
    ' Wait for window to exist (simple loop)
    Set sw = Nothing
    
    For i = 1 To 10
        If pres.SlideShowWindow Is Nothing Then
            DoEvents
        Else
            Set sw = pres.SlideShowWindow
            Exit For
        End If
    Next i
    
    If Not sw Is Nothing Then
        sw.View.GotoSlide slideIndex
    Else
        ' Try getting it from Application.SlideShowWindows
        If Application.SlideShowWindows.Count > 0 Then
            Application.SlideShowWindows(1).View.GotoSlide slideIndex
        End If
    End If

End Sub

Sub RemoveAudio()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim fileNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim targetPath As String
    Dim scope As String
    Dim slideIndex As Integer
    Dim sld As Slide
    Dim s As Shape
    Dim iShape As Integer
    Dim i As Integer
    
    ' 1. Read Parameters
    paramsPath = "/Users/" & Environ("USER") & "/Library/Group Containers/UBF8T346G9.Office/remove_audio_params.txt"
    
    If Dir(paramsPath) = "" Then
        MsgBox "Error: Could not find remove_audio_params.txt"
        Exit Sub
    End If
    
    fileNum = FreeFile
    Open paramsPath For Input As fileNum
    Line Input #fileNum, fileContent
    Close fileNum
    
    ' Format: TargetPath|Scope|SlideIndex
    params = Split(fileContent, "|")
    If UBound(params) < 1 Then Exit Sub
    
    targetPath = params(0)
    scope = params(1)
    If UBound(params) >= 2 Then
        slideIndex = CInt(params(2))
    End If
    
    ' 2. Find Presentation
    Set pres = GetPresentation(targetPath)
    
    If pres Is Nothing Then
        MsgBox "Error: Presentation not found: " & targetPath
        Exit Sub
    End If
    
    ' 3. Remove Audio
    If scope = "all" Then
        For i = 1 To pres.Slides.Count
            Set sld = pres.Slides(i)
            For iShape = sld.Shapes.Count To 1 Step -1
                Set s = sld.Shapes(iShape)
                If InStr(1, s.Name, "ppt_audio") = 1 Then
                    s.Delete
                End If
            Next iShape
        Next i
    ElseIf scope = "slide" Then
        If slideIndex > 0 And slideIndex <= pres.Slides.Count Then
            Set sld = pres.Slides(slideIndex)
            For iShape = sld.Shapes.Count To 1 Step -1
                Set s = sld.Shapes(iShape)
                If InStr(1, s.Name, "ppt_audio") = 1 Then
                    s.Delete
                End If
            Next iShape
        End If
    End If
    
    ' 4. Save
    pres.Save
End Sub
