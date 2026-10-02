import { Button, Text } from "@mantine/core";

type LandingPageProps = {
  onSelectFile?: () => void;
};

export function LandingPage({ onSelectFile }: LandingPageProps) {
  return (
    <>
      <Button onClick={onSelectFile} size="xl">
        Select PowerPoint File
      </Button>
      <Text c="dimmed">Select a .pptx file to begin</Text>
    </>
  );
}
