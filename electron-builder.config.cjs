module.exports = {
  appId: 'dev.jakedoesdev.markdownpodcastnarrator',
  productName: 'Markdown Podcast Narrator',
  executableName: 'MarkdownPodcastNarrator',
  directories: { output: 'release' },
  asar: true,
  mac: {
    target: [{ target: 'dir', arch: ['arm64'] }],
    category: 'public.app-category.music',
    identity: '-',
    hardenedRuntime: false
  },
  win: {
    target: [{ target: 'dir', arch: ['x64'] }],
    signAndEditExecutable: false
  }
};
