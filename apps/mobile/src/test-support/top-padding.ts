/**
 * Test helper (M3-T10): the `paddingTop` a screen's header applies, found by
 * walking up from an element inside the header to the first ancestor whose
 * style carries a `paddingTop`. Same walk as the BUG-007 Home test.
 */
type TreeNode = { props: { style?: unknown }; parent: TreeNode | null };

export function paddingTopAbove(start: TreeNode | null): number | undefined {
  for (let node = start; node; node = node.parent) {
    const layers = [node.props.style].flat(Infinity) as Array<
      { paddingTop?: number } | null | undefined
    >;
    const found = layers.reduce<number | undefined>((acc, l) => l?.paddingTop ?? acc, undefined);
    if (found !== undefined) return found;
  }
  return undefined;
}
