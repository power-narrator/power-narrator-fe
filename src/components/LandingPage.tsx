import { Button, Stack, Text } from "@mantine/core";

interface LandingPageProps {
  onSelectFile?: () => void;
}

export function LandingPage({ onSelectFile }: LandingPageProps) {
  return (
    <Stack>
      <Button onClick={onSelectFile} size="xl" variant="filled" color="blue">
        Select PowerPoint File
      </Button>
      <Text c="dimmed">Select a .pptx file to begin</Text>
    </Stack>
  );
}
