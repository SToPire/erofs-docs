# Configuration file for the Sphinx documentation builder.

# -- Project information

project = 'EROFS'
copyright = '2018-2026, EROFS filesystem developers'
author = 'EROFS filesystem developers'

version = '0.1'
release = version

# -- General configuration

extensions = [
    'myst_parser',
    'sphinx_design',
#    'sphinx.ext.duration',
#    'sphinx.ext.doctest',
#    'sphinx.ext.autodoc',
#    'sphinx.ext.autosummary',
#    'sphinx.ext.intersphinx',
]

myst_enable_extensions = ["colon_fence"]
myst_heading_anchors = 3

templates_path = ['_templates']
exclude_patterns = ['_static/erofs-explorer/*.md']

# -- Options for HTML output

html_static_path = ["_static"]

html_theme = 'sphinx_book_theme'
#html_theme = 'sphinx_rtd_theme'

html_logo = "_static/logo_wide.svg"
html_title = "EROFS filesystem project"

html_theme_options = {
    "home_page_in_toc": True,
    "repository_url": "https://github.com/erofs/docs",
    "repository_branch": "main",
    "path_to_docs": "src",
    "use_repository_button": True,
    "use_edit_page_button": True,
}

from pathlib import Path

# -- Options for EPUB output
epub_show_urls = 'footnote'
epub_exclude_files = [
    '_static/erofs-explorer/README.md',
    '_static/erofs-explorer/explorer.js',
    '_static/erofs-explorer/documented-layouts.js',
    '_static/erofs-explorer/recorded-layout.js',
    '_static/erofs-explorer/options.js',
    '_static/erofs-explorer/layout-data.js',
    '_static/erofs-explorer/compressed-layout.js',
    '_static/erofs-explorer/REAL-IMAGE.md',
    '_static/erofs-explorer/COVERAGE.md',
    '_static/erofs-explorer/explorer.css',
]
epub_exclude_files += [
    f'_static/erofs-explorer/layouts/{path.name}'
    for path in (Path(__file__).parent / '_static/erofs-explorer/layouts').glob('*.json')
]


def use_explorer_template(app, pagename, templatename, context, doctree):
    if app.builder.name == 'html' and pagename == 'ondisk/explorer':
        return 'explorer.html'


def setup(app):
    app.connect('html-page-context', use_explorer_template)
