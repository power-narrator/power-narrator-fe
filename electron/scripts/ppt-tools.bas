Attribute VB_Name = "AudioTools"

Private Const MEDIA_PLAY_EFFECT As Long = 83
Private Const MEDIA_PAUSE_EFFECT As Long = 84
Private Const MEDIA_STOP_EFFECT As Long = 85
Private Const SECTION_AUDIO_PREFIX As String = "ppt_audio_"
Private Const NEW_AUDIO_MARGIN As Single = 20
' Mac PowerPoint fails to read EffectType for some effects, such as ink replay.
Private Const UNREADABLE_EFFECT_TYPE As Long = -1
Private Const PLAY_ACROSS_SLIDES_CHECKBOX As String = "MediaClipPlayAcrossSlides"

Private Type EditingContext
    Captured As Boolean
    Target As DocumentWindow
    ViewType As Long
    SlideNumber As Long
    SelectionType As Long
    ' Shape ids for a shape or text selection, slide numbers for a slide selection.
    SelectedIds() As Long
    SelectedCount As Long
    SelectedOnNotesPage As Boolean
    TextStart As Long
    TextLength As Long
End Type

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

' The notes live in the notes page's body placeholder; Nothing when the page has none
' with a text frame. Read failures are raised.
Function NotesBodyPlaceholder(sld As Slide) As Shape
    Dim notesShape As Shape

    For Each notesShape In sld.NotesPage.Shapes.Placeholders
        If notesShape.PlaceholderFormat.Type = ppPlaceholderBody Then
            If notesShape.HasTextFrame Then Set NotesBodyPlaceholder = notesShape
            Exit Function
        End If
    Next notesShape
End Function

' A notes page without a body placeholder has empty notes; any other read failure is raised.
Function GetSlideNotesText(sld As Slide) As String
    Dim notesBody As Shape

    Set notesBody = NotesBodyPlaceholder(sld)
    If Not notesBody Is Nothing Then GetSlideNotesText = notesBody.TextFrame.TextRange.Text
End Function

Private Function NormalizeLineBreaks(text As String) As String
    NormalizeLineBreaks = Replace(Replace(text, vbCrLf, vbLf), vbCr, vbLf)
End Function

' Print # and Line Input use the legacy Mac encoding, which cannot hold most Unicode text,
' so notes files are encoded and decoded as UTF-8 by hand.
Private Function Utf8Bytes(text As String) As Byte()
    Dim encoded() As Byte
    Dim encodedLength As Long
    Dim i As Long
    Dim codePoint As Long
    Dim lowSurrogate As Long

    ReDim encoded(0 To 3 * Len(text) - 1)
    i = 1
    Do While i <= Len(text)
        codePoint = AscW(Mid(text, i, 1)) And &HFFFF&
        If codePoint >= &HD800& And codePoint <= &HDFFF& Then
            lowSurrogate = 0
            If codePoint <= &HDBFF& And i < Len(text) Then lowSurrogate = AscW(Mid(text, i + 1, 1)) And &HFFFF&
            If lowSurrogate >= &HDC00& And lowSurrogate <= &HDFFF& Then
                codePoint = &H10000& + (codePoint - &HD800&) * &H400& + (lowSurrogate - &HDC00&)
                i = i + 1
            Else
                codePoint = &HFFFD&
            End If
        End If

        If codePoint < &H80& Then
            encoded(encodedLength) = codePoint
            encodedLength = encodedLength + 1
        ElseIf codePoint < &H800& Then
            encoded(encodedLength) = &HC0& Or (codePoint \ &H40&)
            encoded(encodedLength + 1) = &H80& Or (codePoint And &H3F&)
            encodedLength = encodedLength + 2
        ElseIf codePoint < &H10000& Then
            encoded(encodedLength) = &HE0& Or (codePoint \ &H1000&)
            encoded(encodedLength + 1) = &H80& Or ((codePoint \ &H40&) And &H3F&)
            encoded(encodedLength + 2) = &H80& Or (codePoint And &H3F&)
            encodedLength = encodedLength + 3
        Else
            encoded(encodedLength) = &HF0& Or (codePoint \ &H40000&)
            encoded(encodedLength + 1) = &H80& Or ((codePoint \ &H1000&) And &H3F&)
            encoded(encodedLength + 2) = &H80& Or ((codePoint \ &H40&) And &H3F&)
            encoded(encodedLength + 3) = &H80& Or (codePoint And &H3F&)
            encodedLength = encodedLength + 4
        End If
        i = i + 1
    Loop

    ReDim Preserve encoded(0 To encodedLength - 1)
    Utf8Bytes = encoded
End Function

Private Function DecodeUtf8(bytes() As Byte) As String
    Dim decoded As String
    Dim decodedLength As Long
    Dim byteCount As Long
    Dim i As Long
    Dim j As Long
    Dim leadByte As Long
    Dim continuationCount As Long
    Dim minCodePoint As Long
    Dim codePoint As Long

    byteCount = UBound(bytes) + 1
    If byteCount >= 3 Then
        If bytes(0) = &HEF& And bytes(1) = &HBB& And bytes(2) = &HBF& Then i = 3
    End If

    decoded = String(byteCount, " ")
    Do While i < byteCount
        leadByte = bytes(i)
        If leadByte < &H80& Then
            codePoint = leadByte
            continuationCount = 0
            minCodePoint = 0
        ElseIf leadByte >= &HC0& And leadByte < &HE0& Then
            codePoint = leadByte And &H1F&
            continuationCount = 1
            minCodePoint = &H80&
        ElseIf leadByte >= &HE0& And leadByte < &HF0& Then
            codePoint = leadByte And &HF&
            continuationCount = 2
            minCodePoint = &H800&
        ElseIf leadByte >= &HF0& And leadByte < &HF8& Then
            codePoint = leadByte And &H7&
            continuationCount = 3
            minCodePoint = &H10000&
        Else
            Err.Raise vbObjectError + 531, , "The notes are not valid UTF-8 at byte " & i & "."
        End If
        If i + continuationCount >= byteCount Then
            Err.Raise vbObjectError + 531, , "The notes end inside a UTF-8 character."
        End If
        For j = 1 To continuationCount
            If (bytes(i + j) And &HC0&) <> &H80& Then
                Err.Raise vbObjectError + 531, , "The notes are not valid UTF-8 at byte " & (i + j) & "."
            End If
            codePoint = codePoint * &H40& + (bytes(i + j) And &H3F&)
        Next j
        If codePoint < minCodePoint Or codePoint > &H10FFFF& Or (codePoint >= &HD800& And codePoint <= &HDFFF&) Then
            Err.Raise vbObjectError + 531, , "The notes are not valid UTF-8 at byte " & i & "."
        End If
        i = i + continuationCount + 1

        If codePoint >= &H10000& Then
            codePoint = codePoint - &H10000&
            decodedLength = decodedLength + 1
            Mid(decoded, decodedLength, 1) = ChrW(&HD800& + codePoint \ &H400&)
            decodedLength = decodedLength + 1
            Mid(decoded, decodedLength, 1) = ChrW(&HDC00& + (codePoint And &H3FF&))
        Else
            decodedLength = decodedLength + 1
            Mid(decoded, decodedLength, 1) = ChrW(codePoint)
        End If
    Loop

    DecodeUtf8 = Left(decoded, decodedLength)
End Function

Private Sub WriteUtf8File(filePath As String, text As String)
    Dim fileNum As Integer
    Dim bytes() As Byte
    Dim errorNumber As Long
    Dim errorMessage As String

    If Len(text) > 0 Then bytes = Utf8Bytes(text)
    If Dir(filePath) <> "" Then Kill filePath
    fileNum = FreeFile
    Open filePath For Binary Access Write As fileNum
    On Error GoTo Failed
    If Len(text) > 0 Then Put #fileNum, , bytes
    Close fileNum
    Exit Sub

Failed:
    errorNumber = Err.Number
    errorMessage = Err.Description
    Close fileNum
    Err.Raise errorNumber, , errorMessage
End Sub

Private Function ReadUtf8File(filePath As String) As String
    Dim fileNum As Integer
    Dim byteCount As Long
    Dim bytes() As Byte
    Dim errorNumber As Long
    Dim errorMessage As String

    fileNum = FreeFile
    Open filePath For Binary Access Read As fileNum
    On Error GoTo Failed
    byteCount = LOF(fileNum)
    If byteCount > 0 Then
        ReDim bytes(0 To byteCount - 1)
        Get #fileNum, , bytes
    End If
    Close fileNum
    On Error GoTo 0

    If byteCount > 0 Then ReadUtf8File = DecodeUtf8(bytes)
    Exit Function

Failed:
    errorNumber = Err.Number
    errorMessage = Err.Description
    Close fileNum
    Err.Raise errorNumber, , errorMessage
End Function

Function SlideNotesBlock(slideNumber As Integer, notesText As String) As String
    Dim normalizedText As String

    normalizedText = NormalizeLineBreaks(notesText)
    SlideNotesBlock = "###SLIDE_START### " & slideNumber & vbLf
    If Len(normalizedText) > 0 Then SlideNotesBlock = SlideNotesBlock & normalizedText & vbLf
    SlideNotesBlock = SlideNotesBlock & "###SLIDE_END###" & vbLf
End Function

Private Sub WriteNotesExportError(outputPath As String, message As String)
    WriteUtf8File outputPath, "###ERROR### " & Replace(NormalizeLineBreaks(message), vbLf, " ") & vbLf
End Sub

' Output: ###SLIDE_COUNT### n, then one notes block per exported slide, then ###EXPORT_COMPLETE###.
' On failure, the report is a single ###ERROR### message instead.
Sub ExportNotesToFile(pres As Presentation, outputPath As String, Optional slideNumber As Integer = 0)
    Dim content As String
    Dim i As Integer
    Dim context As String

    On Error GoTo ExportFailed

    context = "Could not count the slides"
    content = "###SLIDE_COUNT### " & pres.Slides.Count & vbLf
    If slideNumber > 0 Then
        If slideNumber > pres.Slides.Count Then
            WriteNotesExportError outputPath, "Invalid slide number: " & slideNumber
            Exit Sub
        End If
        context = "Could not read the notes of slide " & slideNumber
        content = content & SlideNotesBlock(slideNumber, GetSlideNotesText(pres.Slides(slideNumber)))
    Else
        For i = 1 To pres.Slides.Count
            context = "Could not read the notes of slide " & i
            content = content & SlideNotesBlock(i, GetSlideNotesText(pres.Slides(i)))
        Next i
    End If
    content = content & "###EXPORT_COMPLETE###" & vbLf

    context = "Could not write the notes report"
    WriteUtf8File outputPath, content
    Exit Sub

ExportFailed:
    WriteNotesExportError outputPath, context & ": " & Err.Description
End Sub

Function GetSectionIndex(audioTag As String) As Integer
    GetSectionIndex = CInt(Mid(audioTag, Len(SECTION_AUDIO_PREFIX) + 1))
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

Private Sub RemoveObsoleteSectionAudio(sld As Slide, slideNumber As Integer, slideNumbers() As Integer, shapeNames() As String, entryCount As Integer, ByRef editing As EditingContext)
    Dim iShape As Integer
    Dim s As Shape

    For iShape = sld.Shapes.Count To 1 Step -1
        Set s = sld.Shapes(iShape)
        If IsSectionAudioShape(s) Then
            If Not IsRequestedSectionAudio(slideNumber, s.Name, slideNumbers, shapeNames, entryCount) Then
                ReplaceSelectedShape editing, sld, s.Id, 0
                s.Delete
            End If
        End If
    Next iShape
End Sub

Private Sub ConfirmSectionAudio(sld As Slide, slideNumber As Integer, slideNumbers() As Integer, shapeNames() As String, entryCount As Integer)
    Dim s As Shape
    Dim found As Integer
    Dim unrequested As Boolean
    Dim expected As String
    Dim expectedCount As Integer
    Dim actual As String
    Dim i As Integer

    For i = 1 To entryCount
        If slideNumbers(i) = slideNumber Then
            If expectedCount > 0 Then expected = expected & ","
            expected = expected & shapeNames(i)
            expectedCount = expectedCount + 1
        End If
    Next i

    For Each s In sld.Shapes
        If IsSectionAudioShape(s) Then
            If IsRequestedSectionAudio(slideNumber, s.Name, slideNumbers, shapeNames, entryCount) Then
                found = found + 1
            Else
                unrequested = True
            End If
        End If
    Next s

    If unrequested Or found <> expectedCount Then
        actual = ListSectionAudio(sld)
        Err.Raise vbObjectError + 530, , "Section audio on slide " & slideNumber & " is " & IIf(Len(actual) = 0, "missing", actual) & " instead of " & IIf(Len(expected) = 0, "none", expected) & "."
    End If
End Sub

Private Function TimelineSequence(sld As Slide, i As Long) As Sequence
    If i = 0 Then
        Set TimelineSequence = sld.TimeLine.MainSequence
    Else
        Set TimelineSequence = sld.TimeLine.InteractiveSequences(i)
    End If
End Function

Private Sub ClearAnimations(sld As Slide, shp As Shape)
    Dim seq As Sequence
    Dim i As Long
    Dim j As Long

    For i = sld.TimeLine.InteractiveSequences.Count To 0 Step -1
        Set seq = TimelineSequence(sld, i)
        For j = seq.Count To 1 Step -1
            If EffectTargetsShape(seq(j), shp) Then seq(j).Delete
        Next j
    Next i
End Sub

' 0 when the effect has no trigger shape, which main-sequence effects may not expose.
Private Function TriggerShapeId(eff As Effect) As Long
    On Error Resume Next
    TriggerShapeId = eff.Timing.TriggerShape.Id
End Function

' The audio's effect types, main-sequence positions and click triggers, for example
' "main:83@2,84@5|click:7:85|click:self:83" (shape 7 is an external button).
' Click sequences are sorted, because copying and rebuilding them can change their order.
Private Function AnimationLayout(sld As Slide, shp As Shape) As String
    Dim seq As Sequence
    Dim i As Long
    Dim j As Long
    Dim effects As String
    Dim mainLayout As String
    Dim clicks() As String
    Dim clickCount As Long
    Dim swap As String

    ReDim clicks(0 To sld.TimeLine.InteractiveSequences.Count)
    For i = 0 To sld.TimeLine.InteractiveSequences.Count
        Set seq = TimelineSequence(sld, i)
        effects = ""
        For j = 1 To seq.Count
            If EffectTargetsShape(seq(j), shp) Then
                If Len(effects) > 0 Then effects = effects & ","
                effects = effects & ReadEffectType(seq(j))
                If i = 0 Then effects = effects & "@" & j
            End If
        Next j
        If Len(effects) > 0 Then
            If i = 0 Then
                mainLayout = "main:" & effects
            Else
                If TriggerShapeId(seq(1)) = shp.Id Then
                    clicks(clickCount) = "click:self:" & effects
                Else
                    clicks(clickCount) = "click:" & TriggerShapeId(seq(1)) & ":" & effects
                End If
                For j = clickCount To 1 Step -1
                    If clicks(j - 1) <= clicks(j) Then Exit For
                    swap = clicks(j - 1)
                    clicks(j - 1) = clicks(j)
                    clicks(j) = swap
                Next j
                clickCount = clickCount + 1
            End If
        End If
    Next i

    AnimationLayout = mainLayout
    For i = 0 To clickCount - 1
        If Len(AnimationLayout) > 0 Then AnimationLayout = AnimationLayout & "|"
        AnimationLayout = AnimationLayout & clicks(i)
    Next i
End Function

Private Function IsExternalTrigger(seq As Sequence, old As Shape) As Boolean
    If seq.Count = 0 Then Exit Function
    If Not EffectTargetsShape(seq(1), old) Then Exit Function
    IsExternalTrigger = TriggerShapeId(seq(1)) <> old.Id
End Function

Private Sub RaiseUnsupported(sld As Slide, shp As Shape, reason As String)
    Err.Raise vbObjectError + 525, , shp.Name & " on slide " & sld.SlideIndex & " " & reason & ", which replacing its audio cannot keep."
End Sub

' Replacement copies the audio's animations, which keeps only Play/Pause/Stop on its own
' main sequence or click triggers. Check before any edit, so nothing is lost silently.
Private Sub CheckReplaceable(sld As Slide, shp As Shape)
    Dim seq As Sequence
    Dim i As Long
    Dim j As Long
    Dim owned As Long
    Dim others As Long
    Dim hasAnimations As Boolean
    Dim hasPlay As Boolean

    For i = 0 To sld.TimeLine.InteractiveSequences.Count
        Set seq = TimelineSequence(sld, i)
        owned = 0
        others = 0
        For j = 1 To seq.Count
            If EffectTargetsShape(seq(j), shp) Then
                owned = owned + 1
                Select Case ReadEffectType(seq(j))
                Case MEDIA_PLAY_EFFECT
                    hasPlay = True
                Case MEDIA_PAUSE_EFFECT, MEDIA_STOP_EFFECT
                Case Else
                    RaiseUnsupported sld, shp, "has an animation other than Play, Pause or Stop"
                End Select
            Else
                others = others + 1
                If TriggerShapeId(seq(j)) = shp.Id Then RaiseUnsupported sld, shp, "starts another shape's animation"
            End If
        Next j
        If owned > 0 Then hasAnimations = True
        If i > 0 And owned > 0 And others > 0 Then RaiseUnsupported sld, shp, "shares a click trigger with other animations"
        If i > 0 And owned > 0 Then
            If seq(1).Timing.TriggerType <> msoAnimTriggerOnShapeClick Then RaiseUnsupported sld, shp, "starts on a bookmark"
        End If
    Next i
    If hasAnimations And Not hasPlay Then RaiseUnsupported sld, shp, "has animations but no Play animation"

    With shp.MediaFormat
        If .MediaBookmarks.Count > 0 Then RaiseUnsupported sld, shp, "has bookmarks"
        If .FadeInDuration > 0 Or .FadeOutDuration > 0 Then RaiseUnsupported sld, shp, "fades in or out"
        If .StartPoint > 0 Or (.EndPoint > 0 And .EndPoint < .Length) Then RaiseUnsupported sld, shp, "is trimmed"
    End With
End Sub

Private Sub AddSectionAudioPlay(sld As Slide, shp As Shape, ByRef newAudioInsertIndex As Integer)
    Dim eff As Effect

    Set eff = sld.TimeLine.MainSequence.AddEffect(shp, MEDIA_PLAY_EFFECT, , msoAnimTriggerAfterPrevious)
    If sld.TimeLine.MainSequence.Count >= newAudioInsertIndex Then eff.MoveTo newAudioInsertIndex
    newAudioInsertIndex = newAudioInsertIndex + 1
End Sub

' Copying animations appends the replacement's effects after all existing effects.
Private Function RestoreMainPositions(sld As Slide, shp As Shape, positions As Collection) As Integer
    Dim i As Long
    Dim j As Long

    j = 1
    For i = 1 To sld.TimeLine.MainSequence.Count
        If EffectTargetsShape(sld.TimeLine.MainSequence(i), shp) Then
            If j <= positions.Count Then sld.TimeLine.MainSequence(i).MoveTo CLng(positions(j))
            j = j + 1
        End If
    Next i
    If positions.Count > 0 Then RestoreMainPositions = positions(positions.Count) + 1
End Function

' Copying turns an external button's click sequence into main-sequence effects at the end of
' the replacement's copies. Rebuild each such sequence on the replacement from the original's
' effects, then remove those copies. Media effects take a trigger shape only by converting an Appear.
Private Sub RestoreExternalTriggers(sld As Slide, old As Shape, shp As Shape)
    Dim mainSeq As Sequence
    Dim seq As Sequence
    Dim rebuilt As Sequence
    Dim eff As Effect
    Dim button As Shape
    Dim copies As Collection
    Dim oldMainCount As Long
    Dim copiedCount As Long
    Dim externalCount As Long
    Dim sequenceCount As Long
    Dim i As Long
    Dim j As Long

    Set mainSeq = sld.TimeLine.MainSequence
    Set copies = New Collection
    For i = 1 To mainSeq.Count
        If EffectTargetsShape(mainSeq(i), old) Then oldMainCount = oldMainCount + 1
    Next i
    For i = 1 To mainSeq.Count
        If EffectTargetsShape(mainSeq(i), shp) Then
            copiedCount = copiedCount + 1
            If copiedCount > oldMainCount Then copies.Add mainSeq(i)
        End If
    Next i
    If copies.Count = 0 Then Exit Sub

    sequenceCount = sld.TimeLine.InteractiveSequences.Count
    For i = 1 To sequenceCount
        Set seq = sld.TimeLine.InteractiveSequences(i)
        If IsExternalTrigger(seq, old) Then externalCount = externalCount + seq.Count
    Next i
    If externalCount <> copies.Count Then
        Err.Raise vbObjectError + 526, , "Replacing " & old.Name & " on slide " & sld.SlideIndex & " copied " & copies.Count & " unexpected main animations for " & externalCount & " button-triggered animations."
    End If

    For i = 1 To sequenceCount
        Set seq = sld.TimeLine.InteractiveSequences(i)
        If IsExternalTrigger(seq, old) Then
            Set button = seq(1).Timing.TriggerShape
            Set rebuilt = sld.TimeLine.InteractiveSequences.Add
            For j = 1 To seq.Count
                Set eff = rebuilt.AddEffect(shp, msoAnimEffectAppear, , seq(j).Timing.TriggerType)
                If j = 1 Then eff.Timing.TriggerShape = button
                eff.EffectType = seq(j).EffectType
                eff.Timing.TriggerDelayTime = seq(j).Timing.TriggerDelayTime
                eff.Timing.RepeatCount = seq(j).Timing.RepeatCount
                eff.Timing.RepeatDuration = seq(j).Timing.RepeatDuration
                eff.Timing.RewindAtEnd = seq(j).Timing.RewindAtEnd
            Next j
        End If
    Next i

    For i = copies.Count To 1 Step -1
        copies(i).Delete
    Next i
End Sub

' Copying animations keeps neither media settings nor geometry.
Private Sub KeepMediaAndGeometry(old As Shape, shp As Shape)
    shp.LockAspectRatio = msoFalse
    shp.Left = old.Left
    shp.Top = old.Top
    shp.Width = old.Width
    shp.Height = old.Height
    shp.Rotation = old.Rotation
    shp.LockAspectRatio = old.LockAspectRatio
    shp.MediaFormat.Volume = old.MediaFormat.Volume
    shp.MediaFormat.Muted = old.MediaFormat.Muted
End Sub

Private Function ReplaceSectionAudio(pres As Presentation, sld As Slide, audioPath As String, audioTag As String, ByRef newAudioInsertIndex As Integer, ByRef editing As EditingContext) As Shape
    Dim shp As Shape
    Dim old As Shape
    Dim layout As String
    Dim replacedLayout As String
    Dim positions As Collection
    Dim i As Long

    Set old = SectionAudioNamed(sld, audioTag)
    Set shp = sld.Shapes.AddMediaObject2(audioPath, msoFalse, msoTrue, 10, 10)
    If shp Is Nothing Then
        Err.Raise vbObjectError + 513, , "Could not insert " & audioTag & " on slide " & sld.SlideIndex & "."
    End If
    ClearAnimations sld, shp

    ' PowerPoint keeps media settings only once the audio has a Play animation.
    If old Is Nothing Then
        shp.Left = pres.PageSetup.SlideWidth + NEW_AUDIO_MARGIN
        shp.Top = NEW_AUDIO_MARGIN + (GetSectionIndex(audioTag) - 1) * (shp.Height + NEW_AUDIO_MARGIN)
        AddSectionAudioPlay sld, shp, newAudioInsertIndex
        shp.MediaFormat.Muted = False
        shp.MediaFormat.Volume = 0.5
    Else
        layout = AnimationLayout(sld, old)
        Set positions = New Collection
        For i = 1 To sld.TimeLine.MainSequence.Count
            If EffectTargetsShape(sld.TimeLine.MainSequence(i), old) Then positions.Add i
        Next i
        If Len(layout) = 0 Then
            AddSectionAudioPlay sld, shp, newAudioInsertIndex
        Else
            ' Adding and clearing media can replace the picked-up animations, so pick up just before applying.
            old.PickupAnimation
            shp.ApplyAnimation
            RestoreExternalTriggers sld, old, shp
        End If
        KeepMediaAndGeometry old, shp
        ReplaceSelectedShape editing, sld, old.Id, shp.Id
        old.Delete

        If Len(layout) > 0 Then
            If positions.Count > 0 Then newAudioInsertIndex = RestoreMainPositions(sld, shp, positions)
            replacedLayout = AnimationLayout(sld, shp)
            If replacedLayout <> layout Then
                Err.Raise vbObjectError + 526, , "Replacing " & audioTag & " on slide " & sld.SlideIndex & " did not keep its animations: expected " & layout & ", found " & replacedLayout & "."
            End If
        End If
    End If

    shp.Name = audioTag
    Set ReplaceSectionAudio = shp
End Function

Function EffectTargetsShape(eff As Effect, shp As Shape) As Boolean
    If Not eff.Shape Is Nothing Then EffectTargetsShape = eff.Shape.Id = shp.Id
End Function

Function ReadEffectType(eff As Effect) As Long
    ReadEffectType = UNREADABLE_EFFECT_TYPE
    On Error Resume Next
    ReadEffectType = eff.EffectType
End Function

' Notes data is UTF-8 holding "###SLIDE_START### <slide number>", the notes lines, then "###SLIDE_END###" per slide.
Private Sub WriteNotesFromFile(pres As Presentation, dataPath As String)
    Dim dataLines() As String
    Dim lineIndex As Long
    Dim lineData As String
    Dim slideNumber As Integer
    Dim notesText As String
    Dim isReading As Boolean
    Dim isFirstLine As Boolean
    Dim notesBody As Shape
    Dim errorMessage As String

    On Error GoTo ReadFailed
    dataLines = Split(NormalizeLineBreaks(ReadUtf8File(dataPath)), vbLf)
    On Error GoTo Failed

    For lineIndex = LBound(dataLines) To UBound(dataLines)
        lineData = dataLines(lineIndex)
        If Left(lineData, 17) = "###SLIDE_START###" Then
            slideNumber = CInt(Mid(lineData, 19))
            notesText = ""
            isReading = True
            isFirstLine = True
        ElseIf Left(lineData, 15) = "###SLIDE_END###" Then
            If slideNumber < 1 Or slideNumber > pres.Slides.Count Then
                Err.Raise vbObjectError + 516, , "Slide " & slideNumber & " does not exist."
            End If
            Set notesBody = NotesBodyPlaceholder(pres.Slides(slideNumber))
            If notesBody Is Nothing Then
                Err.Raise vbObjectError + 528, , "Slide " & slideNumber & " has no notes placeholder."
            End If
            notesBody.TextFrame.TextRange.Text = notesText
            isReading = False
        ElseIf isReading Then
            If isFirstLine Then
                notesText = lineData
                isFirstLine = False
            Else
                notesText = notesText & vbLf & lineData
            End If
        End If
    Next lineIndex
    Exit Sub

ReadFailed:
    errorMessage = "Could not read the notes file: " & Err.Description
    Err.Raise vbObjectError + 529, , errorMessage

Failed:
    errorMessage = "Could not write the notes of slide " & slideNumber & ": " & Err.Description
    Err.Raise vbObjectError + 529, , errorMessage
End Sub

' Input: presentation|resultPath|notesPath|slideNumbers (comma-separated), then
' slideNumber|audioPath|playAcrossSlides (1/0) per section audio. An empty notesPath leaves the notes alone.
' Results: editing once the first save succeeded, inserted|slideNumber|shapeName|playsAcrossSlides
' (the confirmed checkbox, true/false), slide|slideNumber|remainingNames (comma-separated), saved once
' the edits are saved, then done, or error|message at the point of failure.
Sub SaveNarration()
    Dim pres As Presentation
    Dim sld As Slide
    Dim shp As Shape
    Dim paramsPath As String
    Dim paramsNum As Integer
    Dim resultNum As Integer
    Dim fileContent As String
    Dim header() As String
    Dim params() As String
    Dim requested() As String
    Dim requestedSlides() As Integer
    Dim requestedCount As Integer
    Dim slideNumbers() As Integer
    Dim audioPaths() As String
    Dim shapeNames() As String
    Dim playAcross() As Boolean
    Dim entryCount As Integer
    Dim fileName As String
    Dim currentSlideNumber As Integer
    Dim newAudioInsertIndex As Integer
    Dim editing As EditingContext
    Dim errorMessage As String
    Dim restoreError As String
    Dim isRequested As Boolean
    Dim i As Integer
    Dim j As Integer

    paramsPath = GetOfficeFilePath("save_narration_params.txt")
    If Dir(paramsPath) = "" Then Exit Sub

    paramsNum = FreeFile
    Open paramsPath For Input As paramsNum
    If EOF(paramsNum) Then
        Close paramsNum
        Exit Sub
    End If
    Line Input #paramsNum, fileContent
    header = Split(fileContent, "|")
    If UBound(header) < 3 Then
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

    requested = Split(header(3), ",")
    requestedCount = 0
    For i = LBound(requested) To UBound(requested)
        If Len(Trim(requested(i))) > 0 Then
            requestedCount = requestedCount + 1
            ReDim Preserve requestedSlides(1 To requestedCount)
            requestedSlides(requestedCount) = CInt(Trim(requested(i)))
            If requestedSlides(requestedCount) < 1 Or requestedSlides(requestedCount) > pres.Slides.Count Then
                Err.Raise vbObjectError + 516, , "Slide " & requestedSlides(requestedCount) & " does not exist."
            End If
        End If
    Next i

    For i = 1 To entryCount
        isRequested = False
        For j = 1 To requestedCount
            If requestedSlides(j) = slideNumbers(i) Then isRequested = True
        Next j
        If Not isRequested Then
            Err.Raise vbObjectError + 516, , "Section audio for slide " & slideNumbers(i) & " was not requested."
        End If
    Next i

    ' Setting the checkbox selects audio, and replacing audio can delete the selection.
    If entryCount > 0 Then CaptureEditingContext pres, editing

    ' Save before inspecting the audio: reading it can change PowerPoint's stored Play durations,
    ' which this save would otherwise write even when the slide is then left as it was.
    pres.Save
    Print #resultNum, "editing"

    For i = 1 To entryCount
        Set sld = pres.Slides(slideNumbers(i))
        Set shp = SectionAudioNamed(sld, shapeNames(i))
        If Not shp Is Nothing Then CheckReplaceable sld, shp
    Next i

    If Len(header(2)) > 0 Then WriteNotesFromFile pres, header(2)

    currentSlideNumber = 0
    For i = 1 To entryCount
        If slideNumbers(i) <> currentSlideNumber Then
            currentSlideNumber = slideNumbers(i)
            newAudioInsertIndex = 1
        End If

        Set sld = pres.Slides(slideNumbers(i))
        Set shp = ReplaceSectionAudio(pres, sld, audioPaths(i), shapeNames(i), newAudioInsertIndex, editing)
        Print #resultNum, "inserted|" & slideNumbers(i) & "|" & shp.Name & "|" & IIf(SetPlayAcrossSlides(editing, sld, shp, playAcross(i)), "true", "false")
    Next i

    For i = 1 To requestedCount
        Set sld = pres.Slides(requestedSlides(i))
        RemoveObsoleteSectionAudio sld, requestedSlides(i), slideNumbers, shapeNames, entryCount, editing
        Print #resultNum, "slide|" & requestedSlides(i) & "|" & ListSectionAudio(sld)
        ConfirmSectionAudio sld, requestedSlides(i), slideNumbers, shapeNames, entryCount
    Next i

    pres.Save
    Print #resultNum, "saved"
    restoreError = RestoreEditingContext(editing)
    If Len(restoreError) > 0 Then
        Print #resultNum, "error|" & restoreError
    Else
        Print #resultNum, "done"
    End If
    Close resultNum
    Exit Sub

Failed:
    errorMessage = Err.Description
    Resume ReportFailure

ReportFailure:
    On Error Resume Next
    restoreError = RestoreEditingContext(editing)
    If Len(restoreError) > 0 Then errorMessage = errorMessage & " " & restoreError
    Print #resultNum, "error|" & Replace(Replace(errorMessage, vbCr, " "), vbLf, " ")
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

    Set pres = GetPresentation(targetPath)
    If pres Is Nothing Then
        WriteNotesExportError outputPath, "Presentation not found: " & targetPath
        Exit Sub
    End If

    ExportNotesToFile pres, outputPath
End Sub

Sub ExportSlideNotes()
    Dim pres As Presentation
    Dim paramsPath As String
    Dim outputPath As String
    Dim targetPath As String
    Dim fileContent As String
    Dim params() As String
    Dim slideNumber As Integer

    paramsPath = GetOfficeFilePath("export_slide_notes_params.txt")
    fileContent = ReadSingleLineFile(paramsPath, "Error: Could not find export_slide_notes_params.txt")
    If fileContent = "" Then Exit Sub

    params = Split(fileContent, "|")
    If UBound(params) < 2 Then Exit Sub

    targetPath = params(0)
    outputPath = params(2)
    If Not params(1) Like "[1-9]*" Or params(1) Like "*[!0-9]*" Or Len(params(1)) > 4 Then
        WriteNotesExportError outputPath, "Invalid slide number: " & params(1)
        Exit Sub
    End If
    slideNumber = CInt(params(1))

    Set pres = GetPresentation(targetPath)
    If pres Is Nothing Then
        WriteNotesExportError outputPath, "Presentation not found: " & targetPath
        Exit Sub
    End If

    ExportNotesToFile pres, outputPath, slideNumber
End Sub

Private Function HasMediaPlayEffect(sld As Slide, shp As Shape) As Boolean
    Dim seq As Sequence
    Dim i As Long
    Dim j As Long

    For i = 0 To sld.TimeLine.InteractiveSequences.Count
        Set seq = TimelineSequence(sld, i)
        For j = 1 To seq.Count
            If EffectTargetsShape(seq(j), shp) Then
                If ReadEffectType(seq(j)) = MEDIA_PLAY_EFFECT Then
                    HasMediaPlayEffect = True
                    Exit Function
                End If
            End If
        Next j
    Next i
End Function

' Slide Sorter has no current slide, only selected slides; 0 when neither is available.
Private Function WindowSlideNumber(w As DocumentWindow) As Long
    On Error Resume Next
    WindowSlideNumber = w.View.Slide.SlideIndex
    If WindowSlideNumber = 0 Then WindowSlideNumber = w.Selection.SlideRange(1).SlideIndex
End Function

' Activating a window raises it above other apps' windows even when it is already active.
' Activation reports no error when PowerPoint ignores it, which it does while in the background.
Private Sub ActivateWindow(w As DocumentWindow)
    If IsActiveWindow(w) Then Exit Sub
    w.Activate
    If Not IsActiveWindow(w) Then
        Err.Raise vbObjectError + 522, , "PowerPoint did not switch to the window of " & w.Presentation.Name & "."
    End If
End Sub

' False when PowerPoint has no active window.
Private Function IsActiveWindow(w As DocumentWindow) As Boolean
    On Error Resume Next
    IsActiveWindow = ActiveWindow Is w
End Function

Private Sub CaptureEditingContext(pres As Presentation, ByRef editing As EditingContext)
    Dim i As Long

    If pres.Windows.Count = 0 Then
        Err.Raise vbObjectError + 520, , pres.Name & " has no editing window in PowerPoint."
    End If

    Set editing.Target = pres.Windows(1)
    editing.ViewType = editing.Target.ViewType
    editing.SlideNumber = WindowSlideNumber(editing.Target)
    editing.SelectionType = editing.Target.Selection.Type
    editing.SelectedCount = 0

    Select Case editing.SelectionType
    Case ppSelectionShapes, ppSelectionText
        editing.SelectedCount = editing.Target.Selection.ShapeRange.Count
        ReDim editing.SelectedIds(1 To editing.SelectedCount)
        For i = 1 To editing.SelectedCount
            editing.SelectedIds(i) = editing.Target.Selection.ShapeRange(i).Id
        Next i
        If editing.SelectionType = ppSelectionText Then
            editing.SelectedOnNotesPage = editing.Target.ActivePane.ViewType = ppViewNotesPage
            editing.TextStart = editing.Target.Selection.TextRange.Start
            editing.TextLength = editing.Target.Selection.TextRange.Length
        End If
    Case ppSelectionSlides
        editing.SelectedCount = editing.Target.Selection.SlideRange.Count
        ReDim editing.SelectedIds(1 To editing.SelectedCount)
        For i = 1 To editing.SelectedCount
            editing.SelectedIds(i) = editing.Target.Selection.SlideRange(i).SlideIndex
        Next i
    End Select

    editing.Captured = True
End Sub

Private Function ShapeIndexWithId(shapesOnPage As Shapes, shapeId As Long) As Long
    Dim i As Long

    For i = 1 To shapesOnPage.Count
        If shapesOnPage(i).Id = shapeId Then
            ShapeIndexWithId = i
            Exit Function
        End If
    Next i
    Err.Raise vbObjectError + 521, , "The previously selected shape no longer exists."
End Function

Private Sub RestoreSelection(editing As EditingContext)
    Dim pres As Presentation
    Dim shapesOnPage As Shapes
    Dim indices() As Variant
    Dim i As Long

    Set pres = editing.Target.Presentation
    If editing.SelectedCount > 0 Then ReDim indices(0 To editing.SelectedCount - 1)
    Select Case editing.SelectionType
    Case ppSelectionShapes, ppSelectionText
        If editing.SelectedOnNotesPage Then
            Set shapesOnPage = pres.Slides(editing.SlideNumber).NotesPage.Shapes
        Else
            Set shapesOnPage = pres.Slides(editing.SlideNumber).Shapes
        End If
        For i = 0 To editing.SelectedCount - 1
            indices(i) = ShapeIndexWithId(shapesOnPage, editing.SelectedIds(i + 1))
        Next i
        If editing.SelectionType = ppSelectionText Then
            shapesOnPage(indices(0)).TextFrame.TextRange.Characters(editing.TextStart, editing.TextLength).Select
        ElseIf editing.SelectedCount = 1 Then
            shapesOnPage(indices(0)).Select
        Else
            shapesOnPage.Range(indices).Select
        End If
    Case ppSelectionSlides
        For i = 0 To editing.SelectedCount - 1
            indices(i) = editing.SelectedIds(i + 1)
        Next i
        If editing.SelectedCount = 1 Then
            pres.Slides(indices(0)).Select
        Else
            pres.Slides.Range(indices).Select
        End If
    Case Else
        editing.Target.Selection.Unselect
    End Select
End Sub

' The target stays the active window: switching back to another deck needs PowerPoint frontmost and would repeat for every slide.
Private Function RestoreEditingContext(ByRef editing As EditingContext) As String
    If Not editing.Captured Then Exit Function
    editing.Captured = False
    On Error GoTo Failed

    ActivateWindow editing.Target
    If editing.Target.ViewType <> editing.ViewType Then editing.Target.ViewType = editing.ViewType
    If editing.ViewType = ppViewNormal And editing.SlideNumber > 0 Then
        If WindowSlideNumber(editing.Target) <> editing.SlideNumber Then editing.Target.View.GotoSlide editing.SlideNumber
    End If
    RestoreSelection editing
    Exit Function

Failed:
    RestoreEditingContext = "PowerPoint could not restore the previous editing view: " & Err.Description
End Function

' The Ribbon checkbox reflects whatever is selected, so verify the selection is exactly this audio.
Private Sub SelectSectionAudio(editing As EditingContext, sld As Slide, shp As Shape)
    Dim w As DocumentWindow

    Set w = editing.Target
    ActivateWindow w
    If w.ViewType <> ppViewNormal Then w.ViewType = ppViewNormal
    If WindowSlideNumber(w) <> sld.SlideIndex Then w.View.GotoSlide sld.SlideIndex
    shp.Select
    DoEvents

    If Not ActivePresentation Is sld.Parent Then
        Err.Raise vbObjectError + 522, , "PowerPoint did not activate " & sld.Parent.Name & "."
    End If
    If Not IsActiveWindow(w) Then
        Err.Raise vbObjectError + 522, , "PowerPoint did not switch to the window of " & sld.Parent.Name & "."
    End If
    If ActiveWindow.ViewType <> ppViewNormal Then
        Err.Raise vbObjectError + 522, , "PowerPoint did not switch to Normal view."
    End If
    If ActiveWindow.View.Slide.SlideIndex <> sld.SlideIndex Then
        Err.Raise vbObjectError + 522, , "PowerPoint did not go to slide " & sld.SlideIndex & "."
    End If
    If ActiveWindow.Selection.Type <> ppSelectionShapes Then
        Err.Raise vbObjectError + 522, , "PowerPoint did not select " & shp.Name & "."
    End If
    If ActiveWindow.Selection.ShapeRange.Count <> 1 Then
        Err.Raise vbObjectError + 522, , "PowerPoint selected more than " & shp.Name & "."
    End If
    If ActiveWindow.Selection.ShapeRange(1).Id <> shp.Id Then
        Err.Raise vbObjectError + 522, , "PowerPoint selected " & ActiveWindow.Selection.ShapeRange(1).Name & " instead of " & shp.Name & "."
    End If
End Sub

' A checked box can outlive a deleted Play animation until reopening, so require the animation first.
Private Function PlayAcrossSlidesChecked(editing As EditingContext, sld As Slide, shp As Shape) As Boolean
    If Not HasMediaPlayEffect(sld, shp) Then
        Err.Raise vbObjectError + 523, , "It has no Play animation, so Play Across Slides does not apply."
    End If
    SelectSectionAudio editing, sld, shp
    If Not Application.CommandBars.GetEnabledMso(PLAY_ACROSS_SLIDES_CHECKBOX) Then
        Err.Raise vbObjectError + 524, , "PowerPoint's Play Across Slides checkbox is unavailable."
    End If
    PlayAcrossSlidesChecked = Application.CommandBars.GetPressedMso(PLAY_ACROSS_SLIDES_CHECKBOX)
End Function

Private Function SetPlayAcrossSlides(editing As EditingContext, sld As Slide, shp As Shape, playAcross As Boolean) As Boolean
    SetPlayAcrossSlides = PlayAcrossSlidesChecked(editing, sld, shp)
    If SetPlayAcrossSlides = playAcross Then Exit Function

    Application.CommandBars.ExecuteMso PLAY_ACROSS_SLIDES_CHECKBOX
    DoEvents
    SetPlayAcrossSlides = PlayAcrossSlidesChecked(editing, sld, shp)
    If SetPlayAcrossSlides <> playAcross Then
        Err.Raise vbObjectError + 527, , "PowerPoint did not change the Play Across Slides checkbox of " & shp.Name & " on slide " & sld.SlideIndex & "."
    End If
End Function

' newId 0 drops a deleted shape from the captured selection.
Private Sub ReplaceSelectedShape(ByRef editing As EditingContext, sld As Slide, oldId As Long, newId As Long)
    Dim i As Long
    Dim kept As Long

    If editing.SelectionType <> ppSelectionShapes Then Exit Sub
    If editing.SelectedOnNotesPage Or editing.SlideNumber <> sld.SlideIndex Then Exit Sub

    For i = 1 To editing.SelectedCount
        If editing.SelectedIds(i) <> oldId Then
            kept = kept + 1
            editing.SelectedIds(kept) = editing.SelectedIds(i)
        ElseIf newId <> 0 Then
            kept = kept + 1
            editing.SelectedIds(kept) = newId
        End If
    Next i
    editing.SelectedCount = kept
    If kept = 0 Then editing.SelectionType = ppSelectionNone
End Sub

Sub WriteInspectionError(outputPath As String, message As String)
    Dim fileNum As Integer

    fileNum = FreeFile
    Open outputPath For Output As fileNum
    Print #fileNum, "###ERROR### " & message
    Close fileNum
End Sub

' Output: name<TAB>true|false (the Play Across Slides checkbox) per section audio, grouped by slide,
' then ###EXPORT_COMPLETE###. On failure, replace the report with a single ###ERROR### message.
' Reading a checkbox selects its audio, so the editing context is restored once afterward.
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
    Dim context As String
    Dim errorMessage As String
    Dim editing As EditingContext
    Dim restoreError As String
    Dim playsAcross As Boolean

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
                context = "Could not read the Play Across Slides checkbox of " & shp.Name & " on slide " & slideNumber
                ' Audio without a Play animation cannot play, so its possibly stale checkbox is not read.
                playsAcross = False
                If HasMediaPlayEffect(sld, shp) Then
                    If Not editing.Captured Then CaptureEditingContext pres, editing
                    playsAcross = PlayAcrossSlidesChecked(editing, sld, shp)
                End If
                Print #outputNum, shp.Name & vbTab & IIf(playsAcross, "true", "false")
            End If
        Next shp

        Print #outputNum, "###SLIDE_END###"
    Next i

    errorMessage = RestoreEditingContext(editing)
    If Len(errorMessage) > 0 Then GoTo ReportFailure

    Print #outputNum, "###EXPORT_COMPLETE###"
    Close outputNum
    Exit Sub

InspectionFailed:
    errorMessage = context & ": " & Err.Description
    Resume ReportFailure

ReportFailure:
    On Error Resume Next
    restoreError = RestoreEditingContext(editing)
    If Len(restoreError) > 0 Then errorMessage = errorMessage & " " & restoreError
    If outputNum <> 0 Then Close outputNum
    WriteInspectionError outputPath, errorMessage
End Sub
