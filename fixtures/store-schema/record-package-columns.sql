-- The package columns of table record, as schema/qualification.sql of Open-Mixer/plugin-db-qualification holds them at 213ed4971.
  pkg_format  TEXT CHECK (pkg_format IS NULL OR (length(pkg_format) > 0 AND instr(pkg_format, ' ') = 0 AND instr(pkg_format, char(9)) = 0 AND instr(pkg_format, char(10)) = 0)),   -- deb, rpm
  pkg_name    TEXT,
  pkg_version TEXT,
  pkg_release TEXT,
  pkg_distro  TEXT CHECK (pkg_distro IS NULL OR (length(pkg_distro) > 0 AND instr(pkg_distro, ' ') = 0 AND instr(pkg_distro, char(9)) = 0 AND instr(pkg_distro, char(10)) = 0)),   -- e.g. trixie, fc45
  pkg_arch    TEXT CHECK (pkg_arch IS NULL OR (length(pkg_arch) > 0 AND instr(pkg_arch, ' ') = 0 AND instr(pkg_arch, char(9)) = 0 AND instr(pkg_arch, char(10)) = 0)),       -- the package's own arch word: arm64, x86_64, all, noarch
