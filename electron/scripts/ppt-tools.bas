Attribute VB_Name = "AudioTools"

Private Const MEDIA_PLAY_EFFECT As Long = 83
Private Const SECTION_AUDIO_PREFIX As String = "ppt_audio_"
' PowerPoint's Play Across Slides checkbox uses 999 when enabled and 0 when disabled.
Private Const PLAY_ACROSS_SLIDES_SPAN As Long = 999
Private Const CURRENT_SLIDE_SPAN As Long = 0

' ==============================================================================================
' ADD-IN REBUILD INSTRUCTIONS:
' 1. Open PowerPoint.
' 2. Open the VBA editor (Alt+F11, or Fn+Opt+F11 on Mac).
' 3. Remove the existing AudioTools module, if present.
' 4. Choose File -> Import File... and select ppt-tools.bas.
' 5. Save as a PowerPoint Add-in (.ppam), overwriting ppt-tools.ppam.
' 6. Restart PowerPoint to load the rebuilt add-in.
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

' Own only sound shapes named ppt_audio_<positive ordinal>, without leading zeros.
Function IsSectionAudioShape(s As Shape) As Boolean
    Dim ordinal As String

    If s.Type <> msoMedia Then Exit Function
    If s.MediaType <> ppMediaTypeSound Then Exit Function
    If InStr(1, s.Name, SECTION_AUDIO_PREFIX) <> 1 Then Exit Function

    ordinal = Mid(s.Name, Len(SECTION_AUDIO_PREFIX) + 1)
    If Len(ordinal) = 0 Or Left(ordinal, 1) = "0" Then Exit Function
    IsSectionAudioShape = Not ordinal Like "*[!0-9]*"
End Function

Function CountSectionAudioNamed(sld As Slide, shapeName As String) As Integer
    Dim s As Shape

    For Each s In sld.Shapes
        If IsSectionAudioShape(s) Then
            If s.Name = shapeName Then CountSectionAudioNamed = CountSectionAudioNamed + 1
        End If
    Next s
End Function

' Shapes(name) may select same-named text or video; resolve the sound shape explicitly.
Function SectionAudioNamed(sld As Slide, shapeName As String) As Shape
    Dim s As Shape

    For Each s In sld.Shapes
        If IsSectionAudioShape(s) And s.Name = shapeName Then
            If Not SectionAudioNamed Is Nothing Then
                Err.Raise vbObjectError + 518, , "Slide " & sld.SlideIndex & " has more than one section audio named " & shapeName & "."
            End If
            Set SectionAudioNamed = s
        End If
    Next s
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

    Set s = SectionAudioNamed(sld, audioTag)
    If Not s Is Nothing Then
        For effIdx = 1 To sld.TimeLine.MainSequence.Count
            If EffectTargetsShape(sld.TimeLine.MainSequence(effIdx), s) Then
                hadExistingAudio = True
                existingAnimIndex = effIdx
                existingTriggerType = sld.TimeLine.MainSequence(effIdx).Timing.TriggerType
                existingDelay = sld.TimeLine.MainSequence(effIdx).Timing.TriggerDelayTime
                existingRepeatCount = sld.TimeLine.MainSequence(effIdx).Timing.RepeatCount
                existingRepeatDuration = sld.TimeLine.MainSequence(effIdx).Timing.RepeatDuration
                existingRewindAtEnd = sld.TimeLine.MainSequence(effIdx).Timing.RewindAtEnd
                Exit For
            End If
        Next effIdx
        s.Delete
    End If

    Set shp = sld.Shapes.AddMediaObject2(audioPath, 0, -1, 10, 10)
    If shp Is Nothing Then
        Err.Raise vbObjectError + 513, , "Could not insert " & audioTag & " on slide " & sld.SlideIndex & "."
    End If

    shp.Name = audioTag

    margin = 20

    sectionIdx = GetSectionIndex(audioTag)

    shp.Left = pres.PageSetup.SlideWidth + margin

    shp.Top = margin + (sectionIdx - 1) * (shp.Height + margin)

    For i = sld.TimeLine.MainSequence.Count To 1 Step -1
        If EffectTargetsShape(sld.TimeLine.MainSequence(i), shp) Then
            sld.TimeLine.MainSequence(i).Delete
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
        ' Place new audio first, in section order.
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

Function SectionAudioPlayEffect(sld As Slide, shp As Shape) As Effect
    Dim i As Long

    For i = 1 To sld.TimeLine.MainSequence.Count
        If sld.TimeLine.MainSequence(i).EffectType = MEDIA_PLAY_EFFECT Then
            If EffectTargetsShape(sld.TimeLine.MainSequence(i), shp) Then
                Set SectionAudioPlayEffect = sld.TimeLine.MainSequence(i)
                Exit Function
            End If
        End If
    Next i
End Function

Sub ApplySectionAudioPlayback(sld As Slide, shp As Shape, playAcrossSlides As Boolean)
    Dim effectCount As Long
    Dim playback As PlaySettings
    Dim i As Long

    For i = 1 To sld.TimeLine.MainSequence.Count
        If EffectTargetsShape(sld.TimeLine.MainSequence(i), shp) Then effectCount = effectCount + 1
    Next i
    If effectCount <> 1 Or SectionAudioPlayEffect(sld, shp) Is Nothing Then
        Err.Raise vbObjectError + 517, , shp.Name & " on slide " & sld.SlideIndex & " has " & effectCount & " animations instead of one play effect."
    End If

    Set playback = SectionAudioPlayEffect(sld, shp).EffectInformation.PlaySettings
    If playAcrossSlides Then
        playback.PlayOnEntry = msoTrue
        playback.PauseAnimation = msoFalse
        playback.StopAfterSlides = PLAY_ACROSS_SLIDES_SPAN
    Else
        playback.StopAfterSlides = CURRENT_SLIDE_SPAN
    End If
End Sub

Function EffectTargetsShape(eff As Effect, shp As Shape) As Boolean
    If Not eff.Shape Is Nothing Then EffectTargetsShape = eff.Shape.Id = shp.Id
End Function

Function EffectShapeId(eff As Effect) As Long
    If Not eff.Shape Is Nothing Then EffectShapeId = eff.Shape.Id
End Function

Function SaveSlideTiming(sld As Slide) As Collection
    Dim i As Long
    Dim records As Collection
    Dim record As Collection
    Dim eff As Effect

    Set records = New Collection
    For i = 1 To sld.TimeLine.MainSequence.Count
        Set eff = sld.TimeLine.MainSequence(i)
        Set record = New Collection
        record.Add EffectShapeId(eff), "shapeId"
        record.Add eff.EffectType, "effectType"
        record.Add eff.Timing.TriggerType, "triggerType"
        record.Add eff.Timing.TriggerDelayTime, "delay"
        records.Add record
    Next i
    Set SaveSlideTiming = records
End Function

Sub RestoreSlideTiming(sld As Slide, records As Collection)
    Dim i As Long
    Dim record As Collection

    If sld.TimeLine.MainSequence.Count <> records.Count Then
        Err.Raise vbObjectError + 519, , "Setting section audio playback on slide " & sld.SlideIndex & " changed its animations."
    End If
    For i = 1 To records.Count
        Set record = records(i)
        If EffectShapeId(sld.TimeLine.MainSequence(i)) <> record("shapeId") Or sld.TimeLine.MainSequence(i).EffectType <> record("effectType") Then
            Err.Raise vbObjectError + 519, , "Setting section audio playback on slide " & sld.SlideIndex & " changed its animation order."
        End If
        With sld.TimeLine.MainSequence(i).Timing
            If .TriggerType <> record("triggerType") Then .TriggerType = record("triggerType")
            If Abs(.TriggerDelayTime - record("delay")) > 0.001 Then .TriggerDelayTime = record("delay")
        End With
    Next i
    For i = 1 To records.Count
        Set record = records(i)
        With sld.TimeLine.MainSequence(i).Timing
            If .TriggerType <> record("triggerType") Or Abs(.TriggerDelayTime - record("delay")) > 0.001 Then
                Err.Raise vbObjectError + 519, , "Setting section audio playback on slide " & sld.SlideIndex & " changed the start or delay of its animations."
            End If
        End With
    Next i
End Sub

' Keep this helper: inline reads on Mac can misreport disabled playback after reopening.
' No play effect returns 0 (current slide only).
Function SectionAudioStopAfterSlides(sld As Slide, shp As Shape) As Long
    Dim eff As Effect
    Dim playback As PlaySettings

    Set eff = SectionAudioPlayEffect(sld, shp)
    If eff Is Nothing Then Exit Function
    Set playback = eff.EffectInformation.PlaySettings
    SectionAudioStopAfterSlides = playback.StopAfterSlides
End Function

Function SectionAudioPlaybackReport(sld As Slide, shp As Shape) As String
    Dim playback As PlaySettings

    Set playback = SectionAudioPlayEffect(sld, shp).EffectInformation.PlaySettings
    SectionAudioPlaybackReport = SectionAudioStopAfterSlides(sld, shp) & "|" & IIf(playback.PlayOnEntry = msoTrue, "1", "0") & "|" & IIf(playback.PauseAnimation = msoTrue, "1", "0")
End Function

' Input: presentation|resultPath, then slideNumber|audioPath|playAcrossSlides (1/0) per entry.
' Each submitted slide's entries replace its complete section audio.
' Results: inserted|slideNumber|shapeName|stopAfterSlides|playOnEntry|pauseAnimation (flags 1/0),
' slide|slideNumber|remainingNames (comma-separated), error|message, and done after saving.
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
    Dim playAcross() As Boolean
    Dim entryCount As Integer
    Dim fileName As String
    Dim currentSlideNumber As Integer
    Dim newAudioInsertIndex As Integer
    Dim slideTiming As Collection
    Dim i As Integer
    Dim j As Integer

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
            If UBound(params) < 2 Then
                Err.Raise vbObjectError + 514, , "Malformed audio line: " & fileContent
            End If

            entryCount = entryCount + 1
            ReDim Preserve slideNumbers(1 To entryCount)
            ReDim Preserve audioPaths(1 To entryCount)
            ReDim Preserve shapeNames(1 To entryCount)
            ReDim Preserve playAcross(1 To entryCount)

            slideNumbers(entryCount) = CInt(params(0))
            audioPaths(entryCount) = params(1)
            playAcross(entryCount) = params(2) = "1"
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

    For i = 1 To entryCount
        If slideNumbers(i) < 1 Or slideNumbers(i) > pres.Slides.Count Then
            Err.Raise vbObjectError + 516, , "Slide " & slideNumbers(i) & " does not exist."
        End If
        If CountSectionAudioNamed(pres.Slides(slideNumbers(i)), shapeNames(i)) > 1 Then
            Err.Raise vbObjectError + 518, , "Slide " & slideNumbers(i) & " has more than one shape named " & shapeNames(i) & "."
        End If
    Next i

    currentSlideNumber = 0
    For i = 1 To entryCount
        If slideNumbers(i) <> currentSlideNumber Then
            currentSlideNumber = slideNumbers(i)
            newAudioInsertIndex = 1
        End If

        Set shp = ReplaceSectionAudio(pres, pres.Slides(slideNumbers(i)), audioPaths(i), shapeNames(i), newAudioInsertIndex)
    Next i

    For i = 1 To entryCount
        If IsFirstEntryForSlide(slideNumbers, i) Then
            Set sld = pres.Slides(slideNumbers(i))
            ' Apply playback after rebuilding effects. On Mac, these writes reset play-effect
            ' triggers and delays across the slide; snapshot once and restore after all writes.
            Set slideTiming = SaveSlideTiming(sld)
            For j = i To entryCount
                If slideNumbers(j) = slideNumbers(i) Then
                    Set shp = SectionAudioNamed(sld, shapeNames(j))
                    If shp Is Nothing Then Err.Raise vbObjectError + 513, , "Section audio not found: " & shapeNames(j)
                    ApplySectionAudioPlayback sld, shp, playAcross(j)
                End If
            Next j
            RestoreSlideTiming sld, slideTiming
        End If
    Next i

    For i = 1 To entryCount
        Set sld = pres.Slides(slideNumbers(i))
        Set shp = SectionAudioNamed(sld, shapeNames(i))
        If shp Is Nothing Then Err.Raise vbObjectError + 513, , "Section audio not found: " & shapeNames(i)
        Print #resultNum, "inserted|" & slideNumbers(i) & "|" & shp.Name & "|" & SectionAudioPlaybackReport(sld, shp)
    Next i

    ' Delay cleanup until replacements have preserved the old animation settings.
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

Sub WriteInspectionError(outputPath As String, message As String)
    Dim fileNum As Integer

    fileNum = FreeFile
    Open outputPath For Output As fileNum
    Print #fileNum, "###ERROR### " & message
    Close fileNum
End Sub

' Output: name<TAB>StopAfterSlides per section audio, grouped by slide, then ###EXPORT_COMPLETE###.
' On failure, replace the report with a single ###ERROR### message.
Sub ExportSectionAudioPlayback()
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
            If IsSectionAudioShape(shp) Then
                context = "Could not read the playback of " & shp.Name & " on slide " & slideNumber
                stopAfterSlides = CStr(SectionAudioStopAfterSlides(sld, shp))
                Print #outputNum, shp.Name & vbTab & stopAfterSlides
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
    
End Sub

' Input: presentation|slideNumbers|resultPath (comma-separated slide numbers).
' Uses InsertAudio's result format without inserted records.
Sub RemoveAudio()
    Dim pres As Presentation
    Dim sld As Slide
    Dim s As Shape
    Dim paramsPath As String
    Dim paramsNum As Integer
    Dim resultNum As Integer
    Dim fileContent As String
    Dim params() As String
    Dim slideNumbers() As String
    Dim slideNumber As Integer
    Dim iShape As Integer
    Dim i As Integer

    paramsPath = GetOfficeFilePath("remove_audio_params.txt")
    If Dir(paramsPath) = "" Then Exit Sub

    paramsNum = FreeFile
    Open paramsPath For Input As paramsNum
    If EOF(paramsNum) Then
        Close paramsNum
        Exit Sub
    End If
    Line Input #paramsNum, fileContent
    Close paramsNum

    params = Split(fileContent, "|")
    If UBound(params) < 2 Then Exit Sub

    resultNum = FreeFile
    Open params(2) For Output As resultNum
    On Error GoTo Failed

    Set pres = GetPresentation(params(0))
    If pres Is Nothing Then
        Err.Raise vbObjectError + 515, , "Presentation not found: " & params(0)
    End If

    slideNumbers = Split(params(1), ",")
    For i = LBound(slideNumbers) To UBound(slideNumbers)
        If Len(Trim(slideNumbers(i))) > 0 Then
            slideNumber = CInt(Trim(slideNumbers(i)))
            If slideNumber < 1 Or slideNumber > pres.Slides.Count Then
                Err.Raise vbObjectError + 516, , "Slide " & slideNumber & " does not exist."
            End If

            Set sld = pres.Slides(slideNumber)
            For iShape = sld.Shapes.Count To 1 Step -1
                Set s = sld.Shapes(iShape)
                If IsSectionAudioShape(s) Then s.Delete
            Next iShape
            Print #resultNum, "slide|" & slideNumber & "|" & ListSectionAudio(sld)
        End If
    Next i

    pres.Save
    Print #resultNum, "done"
    Close resultNum
    Exit Sub

Failed:
    Print #resultNum, "error|" & Replace(Replace(Err.Description, vbCr, " "), vbLf, " ")
    Close resultNum
End Sub
