import { Center, Text, type CenterProps, type ElementProps, type MantineSize } from "@mantine/core";

type PreviewUnavailablePlaceholderProps = CenterProps &
  ElementProps<"div"> & {
    size?: MantineSize;
  };

export function PreviewUnavailablePlaceholder({
  size,
  ...centerProps
}: PreviewUnavailablePlaceholderProps) {
  return (
    <Center {...centerProps}>
      <Text size={size} c="dimmed" ta="center">
        Preview unavailable
      </Text>
    </Center>
  );
}
