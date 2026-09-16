/**
 * Stand-ins for the commercial packages this build does not ship.
 *
 * Screenshots are a Pro feature, so the open-source server has no browser
 * plane at all and every capture attempt fails loudly rather than silently
 * returning a blank image.
 */
export class FakeBrowserPlane {
  async capture(): Promise<never> {
    throw new Error("Visual capture is not available in the open-source build.");
  }
}
