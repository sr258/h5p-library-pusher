import * as H5P from 'h5p-nodejs-library';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import * as os from 'os';

const token = process.env['NPM_AUTH_TOKEN'];
const npmUser = process.env['NPM_USER'];
const dryRun = process.env['DRY_RUN'] === 'true';
const libDir = path.resolve('working_dir/libraries');

const dummyUser = {
    id: '1',
    canCreateRestricted: true,
    canInstallRecommended: true,
    canUpdateAndInstallLibraries: true,
    name: '',
    type: ''
};

function machineNameToMirrorPackageName(machineName: string): string {
    return `@${npmUser}/${machineName.toLowerCase().replace('.', '-')}`;
}

function dependenciesFromLibraryInfo(
    libraryInfo: H5P.IInstalledLibrary
): { [key: string]: string } {
    return (libraryInfo.editorDependencies || [])
        .concat(libraryInfo.preloadedDependencies || [])
        .reduce((prev, curr) => {
            prev[
                machineNameToMirrorPackageName(curr.machineName)
            ] = `${curr.majorVersion}.${curr.minorVersion}.x`;
            return prev;
        }, {});
}

function convertToSpdxLicenseName(license: string): string {
    switch (license) {
        case 'MPL':
            return 'MPL-1.0';
        case 'MPL2':
            return 'MPL-2.0';
        case 'pd':
            return 'Public Domain';
        case undefined:
            return 'see license in GitHub Repository';
        default:
            return license;
    }
}

async function cleanLibraryDir() {
    await fsExtra.remove(libDir);
}

async function main() {
    if (!token) {
        console.error(
            chalk.red(
                'Incorrect parameters: You must pass a NPM token with the environment variable NPM_AUTH_TOKEN!'
            )
        );
        process.exit(1);
    }
    if (!npmUser) {
        console.error(
            chalk.red(
                'Incorrect parameters: You must pass a NPM username with the environment variable NPM_USER!'
            )
        );
        process.exit(1);
    }

    const editor = new H5P.H5PEditor(
        new H5P.fsImplementations.InMemoryStorage(),
        new H5P.EditorConfig(
            new H5P.fsImplementations.JsonStorage(
                path.resolve('h5p-config.json')
            )
        ),
        new H5P.fsImplementations.FileLibraryStorage(libDir),
        new H5P.fsImplementations.FileContentStorage(
            path.resolve('working_dir/content')
        ),
        new H5P.TranslationService({}, {}),
        new H5P.fsImplementations.DirectoryTemporaryFileStorage(
            path.resolve('working_dir/temp')
        )
    );

    await editor.contentTypeCache.forceUpdate();

    await fsExtra.writeFile(
        path.join(os.homedir(), '.npmrc'),
        `//registry.npmjs.org/:_authToken=${token}`,
        { encoding: 'utf8' }
    );

    try {
        let errors = 0;
        let cache: any;
        do {
            cache = await editor.contentTypeRepository.get(dummyUser);
            const libToInstall = cache.libraries.find(
                l => !l.installed && l.canInstall
            );

            if (!libToInstall) {
                break;
            }
            console.log(
                `[${libToInstall.machineName}] Downloading updated/new content type from Hub...`
            );
            const installResult = await editor.installLibrary(
                libToInstall.machineName,
                dummyUser
            );
            for (const installedLib of installResult) {
                console.log(
                    `[${H5P.LibraryName.toUberName(
                        installedLib.newVersion
                    )}] Publishing ${
                        installedLib.type
                    } library to NPM registry...`
                );
                const libraryInfo = await editor.libraryManager.loadLibrary(
                    installedLib.newVersion
                );
                const packageJson = {
                    name: machineNameToMirrorPackageName(
                        libraryInfo.machineName
                    ),
                    version: `${libraryInfo.majorVersion}.${libraryInfo.minorVersion}.${libraryInfo.patchVersion}`,
                    description: `An unofficial mirrored version of the distribution files of the H5P library ${libraryInfo.machineName} from the H5P Hub`,
                    license: convertToSpdxLicenseName(libraryInfo.license),
                    author: `${libraryInfo.author} (uploaded by ${npmUser})`,
                    dependencies: dependenciesFromLibraryInfo(libraryInfo)
                };
                const packageDir = path.join(
                    libDir,
                    H5P.LibraryName.toUberName(libraryInfo)
                );
                await fsExtra.writeJSON(
                    path.join(packageDir, 'package.json'),
                    packageJson
                );
                try {
                    execSync(
                        `npm publish --access=public${
                            dryRun ? ' --dry-run' : ''
                        }`,
                        {
                            cwd: packageDir,
                            stdio: 'ignore'
                        }
                    );
                    console.log(
                        chalk.green(
                            `[${H5P.LibraryName.toUberName(
                                installedLib.newVersion
                            )}] published!`
                        )
                    );
                } catch (error) {
                    console.error(
                        chalk.red(
                            `[${H5P.LibraryName.toUberName(
                                installedLib.newVersion
                            )}] Error publishing to NPM registry!`
                        )
                    );
                    console.error(error.message);
                    errors++;
                }
            }
        } while (cache.libraries.some(l => !l.installed && l.canInstall));
        if (!errors) {
            console.log(chalk.green('Finished with no errors!'));
            process.exit(0);
        } else {
            console.error(chalk.red(`Finished with ${errors} errors!`));
            process.exit(errors);
        }
    } catch (error) {
        console.error(chalk.red(error));
        await cleanLibraryDir();
        process.exit(1);
    }
}

main();
